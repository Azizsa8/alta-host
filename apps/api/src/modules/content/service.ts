import { prisma } from "../../db.js";
import { emitEvent } from "../events/bus.js";
import { recordAudit } from "../audit/service.js";
import { publisherFor } from "./publisher.js";

export const CONTENT_CHANNELS = ["instagram", "facebook", "tiktok"] as const;

/**
 * §7's approval gate as a transition table: `published` is reachable only
 * from `approved`/`scheduled`, and `approved` only through the explicit
 * approve() call that records who approved. Nothing else compiles a path
 * to publication.
 */
const TRANSITIONS: Record<string, string[]> = {
  idea: ["draft", "rejected"],
  draft: ["in_review", "rejected"],
  in_review: ["approved", "rejected", "draft"], // draft = sent back with edits
  approved: ["scheduled", "published"],
  scheduled: ["published", "failed", "approved"], // approved = unscheduled
  failed: ["scheduled", "rejected"], // retry or give up
  published: [],
  rejected: ["draft"], // resurrect with edits
};

export function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

type Actor = { staffId: string; name: string; propertyId: string };

/**
 * §6-هـ step 2: idea generation grounded in the brand profile. Rule-based
 * and deterministic like the NLU engine — a metered LLM generator plugs in
 * behind the same signature later (§8), and the approval flow around it
 * does not change.
 */
export async function generateIdeas(propertyId: string): Promise<string[]> {
  const profile = await prisma.brandProfile.findUnique({ where: { propertyId } });
  const services = (profile?.services as string[] | undefined) ?? [];
  const offers = (profile?.offers as string[] | undefined) ?? [];

  const ideas: string[] = [];
  for (const offer of offers.slice(0, 3)) ideas.push(`إعلان عرض: ${offer} — مع دعوة واضحة للحجز المباشر`);
  for (const service of services.slice(0, 3)) ideas.push(`تسليط الضوء على ${service} بصور حقيقية من الفندق`);
  ideas.push(
    "قصة نزيل: تجربة إقامة مميزة بصيغة قصيرة (بعد إذن النزيل)",
    "خلف الكواليس: فريق الاستقبال يجهّز ليوم كامل",
    "نصيحة سفر محلية: أفضل ٣ أماكن قريبة من الفندق"
  );
  return ideas.slice(0, 6);
}

/** Draft copy for an idea, in the brand's tone and language(s). */
export async function draftFromIdea(propertyId: string, idea: string): Promise<{ bodyAr: string; bodyEn: string }> {
  const profile = await prisma.brandProfile.findUnique({ where: { propertyId } });
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  const name = property?.name ?? "فندقنا";
  const identity = profile?.identity ? ` ${profile.identity}` : "";
  const bodyAr = `${idea}\n\nفي ${name}${identity} — نسعد باستقبالكم.\nللحجز والاستفسار: تواصلوا معنا عبر واتساب. ✨`;
  const bodyEn =
    profile?.language === "ar"
      ? ""
      : `${idea}\n\nAt ${name}, we look forward to welcoming you.\nBook or ask us anytime on WhatsApp. ✨`;
  return { bodyAr, bodyEn };
}

/** Single choke-point for every status change: validates the transition
 *  table, stamps approver on approve, audits, emits. */
export async function transitionContent(params: {
  actor: Actor;
  contentId: string;
  to: string;
  scheduledAt?: Date;
}): Promise<{ ok: true; item: unknown } | { ok: false; status: number; error: string }> {
  const item = await prisma.contentItem.findUnique({ where: { id: params.contentId } });
  if (!item || item.propertyId !== params.actor.propertyId) {
    return { ok: false, status: 404, error: "content not found" };
  }
  if (!canTransition(item.status, params.to)) {
    return { ok: false, status: 422, error: `cannot move ${item.status} → ${params.to}` };
  }
  if (params.to === "scheduled" && !params.scheduledAt && !item.scheduledAt) {
    return { ok: false, status: 422, error: "scheduled requires scheduledAt" };
  }
  // Publishing is not a plain transition — it must go through publishContent
  // so the platform call and the status change stay atomic.
  if (params.to === "published") {
    return { ok: false, status: 422, error: "use the publish endpoint" };
  }

  const updated = await prisma.contentItem.update({
    where: { id: item.id },
    data: {
      status: params.to,
      ...(params.to === "approved" ? { approvedBy: params.actor.staffId } : {}),
      ...(params.scheduledAt ? { scheduledAt: params.scheduledAt } : {}),
    },
  });
  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: `content.${params.to}`,
    resourceType: "ContentItem",
    resourceId: item.id,
    outcome: "success",
    metadata: { channel: item.channel },
  });
  await emitEvent(params.actor.propertyId, {
    type: "content.status",
    contentId: item.id,
    channel: item.channel,
    status: params.to,
  });
  return { ok: true, item: updated };
}

/**
 * The only path to `published`. Requires approved/scheduled (§7 — approval
 * happened, recorded), resolves media to storage URLs, calls the channel
 * adapter, and records success or failure + alert.
 */
export async function publishContent(params: {
  actor: Actor;
  contentId: string;
}): Promise<{ ok: true; resultUrl: string } | { ok: false; status: number; error: string }> {
  const item = await prisma.contentItem.findUnique({ where: { id: params.contentId } });
  if (!item || item.propertyId !== params.actor.propertyId) {
    return { ok: false, status: 404, error: "content not found" };
  }
  if (item.status !== "approved" && item.status !== "scheduled") {
    return { ok: false, status: 422, error: `cannot publish from ${item.status} — approval required (§7)` };
  }

  const result = await publisherFor(item.channel).publish({
    propertyId: item.propertyId,
    channel: item.channel,
    bodyText: item.bodyAr || item.bodyEn,
    mediaUrls: [], // presigned URLs resolved at the adapter layer when a real channel needs them
  });

  if (!result.ok) {
    await prisma.contentItem.update({ where: { id: item.id }, data: { status: "failed" } });
    await emitEvent(item.propertyId, {
      type: "content.failed",
      contentId: item.id,
      channel: item.channel,
      error: result.error ?? "publish failed",
    });
    return { ok: false, status: 502, error: result.error ?? "publish failed" };
  }

  await prisma.contentItem.update({
    where: { id: item.id },
    data: { status: "published", publishedAt: new Date(), resultUrl: result.resultUrl ?? "" },
  });
  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "content.published",
    resourceType: "ContentItem",
    resourceId: item.id,
    outcome: "success",
    metadata: { channel: item.channel, resultUrl: result.resultUrl },
  });
  await emitEvent(item.propertyId, {
    type: "content.published",
    contentId: item.id,
    channel: item.channel,
    resultUrl: result.resultUrl ?? "",
  });
  return { ok: true, resultUrl: result.resultUrl ?? "" };
}

/** Scheduler tick: publish everything whose moment has come. Retries stay
 *  manual-first (failed → scheduled via the UI) — silent infinite retry
 *  on a rejected post is how accounts get flagged. */
export async function publishDueContent(): Promise<number> {
  const due = await prisma.contentItem.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    take: 20,
  });
  let published = 0;
  for (const item of due) {
    const result = await publishContent({
      actor: { staffId: "scheduler", name: "المجدول الآلي", propertyId: item.propertyId },
      contentId: item.id,
    });
    if (result.ok) published++;
  }
  return published;
}
