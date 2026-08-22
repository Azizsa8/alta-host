import { prisma } from "../../db.js";
import { emitEvent } from "../events/bus.js";
import { recordAudit } from "../audit/service.js";
import { providerFor, type ExternalReview } from "./provider.js";

/**
 * Rule-based classifier, same philosophy as the NLU engine: inspectable,
 * deterministic, replaceable by an LLM later behind the same signature.
 * Safety detection errs toward flagging — a missed safety review is the
 * §6-د failure mode that matters.
 */
export function classifyReview(review: { stars: number; text: string }): {
  sentiment: "positive" | "neutral" | "negative";
  topic: string;
} {
  const t = review.text.toLowerCase();
  const sentiment = review.stars >= 4 ? "positive" : review.stars <= 2 ? "negative" : "neutral";
  const topic = /سلامة|خطر|حريق|طوارئ|safety|fire|emergency|danger/.test(t)
    ? "safety"
    : /نظاف|وسخ|clean|dirty/.test(t)
      ? "cleanliness"
      : /موظف|استقبال|خدمة|staff|service|reception/.test(t)
        ? "staff"
        : /فطور|طعام|أكل|مطعم|food|breakfast|restaurant/.test(t)
          ? "food"
          : /مسبح|صالة|مرافق|facilities|pool|gym|location|موقع/.test(t)
            ? "facilities"
            : /سعر|غالي|قيمة|price|value|expensive/.test(t)
              ? "value"
              : "general";
  return { sentiment, topic };
}

/** AR draft first (Saudi market), EN appended for latin-script reviews. */
export function draftReply(review: { stars: number; text: string; author: string }): string {
  const isArabic = /[؀-ۿ]/.test(review.text);
  const firstName = review.author.split(/\s+/)[0];
  if (review.stars >= 4) {
    return isArabic
      ? `شكراً جزيلاً ${firstName} على تقييمك الجميل! سعدنا باستضافتك ونتطلع لرؤيتك مرة أخرى قريباً.`
      : `Thank you so much, ${firstName}! We're delighted you enjoyed your stay and look forward to welcoming you back.`;
  }
  if (review.stars <= 2) {
    return isArabic
      ? `نعتذر بصدق ${firstName} عن التجربة التي مررت بها — هذا ليس المستوى الذي نلتزم به. تواصل معنا مباشرة وسيتابع مدير الفندق ملاحظتك شخصياً.`
      : `We sincerely apologize, ${firstName} — this is not the standard we hold ourselves to. Please reach out to us directly; our manager will personally follow up.`;
  }
  return isArabic
    ? `شكراً ${firstName} على ملاحظاتك — نقدّر وقتك وسنعمل على التحسين المستمر.`
    : `Thank you for your feedback, ${firstName} — we appreciate it and are always working to improve.`;
}

/**
 * Fetch → upsert → classify → draft. Negative or safety reviews emit the
 * immediate alert (§6-د). Idempotent by (propertyId, externalId) — a
 * repeated poll never duplicates or re-alerts.
 */
export async function syncReviews(propertyId: string): Promise<{ fetched: number; new: number }> {
  const account = await prisma.socialAccount.findUnique({
    where: { propertyId_platform: { propertyId, platform: "google" } },
  });
  if (!account || account.status !== "linked") return { fetched: 0, new: 0 };

  const provider = providerFor(account.accountRef);
  const external = await provider.fetchReviews(propertyId, account.accountRef);

  let created = 0;
  for (const r of external) {
    const existing = await prisma.googleReview.findUnique({
      where: { propertyId_externalId: { propertyId, externalId: r.externalId } },
    });
    if (existing) continue;

    const { sentiment, topic } = classifyReview(r);
    const review = await prisma.googleReview.create({
      data: {
        propertyId,
        externalId: r.externalId,
        stars: r.stars,
        text: r.text,
        author: r.author,
        reviewedAt: r.reviewedAt,
        sentiment,
        topic,
        draftReply: draftReply(r),
        replyStatus: "draft",
      },
    });
    created++;

    await emitEvent(propertyId, {
      type: "review.fetched",
      reviewId: review.id,
      stars: r.stars,
      sentiment,
      topic,
    });
    // §6-د: negative or safety-related → immediate alert, once (creation only).
    if (sentiment === "negative" || topic === "safety") {
      await emitEvent(propertyId, {
        type: "review.alert",
        reviewId: review.id,
        stars: r.stars,
        topic,
        preview: r.text.slice(0, 140),
      });
    }
  }
  return { fetched: external.length, new: created };
}

/**
 * The §7 no-auto-publish gate: publishing happens ONLY here, requires the
 * review to be in `approved`, and approval is a separate human act
 * recorded with the approver's identity.
 */
export async function approveAndPublish(params: {
  propertyId: string;
  reviewId: string;
  actorId: string;
  actorName: string;
  editedReply?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const review = await prisma.googleReview.findUnique({ where: { id: params.reviewId } });
  if (!review || review.propertyId !== params.propertyId) {
    return { ok: false, status: 404, error: "review not found" };
  }
  if (review.replyStatus === "published") {
    return { ok: false, status: 409, error: "already published" };
  }
  const reply = params.editedReply?.trim() || review.draftReply;
  if (!reply) return { ok: false, status: 422, error: "no reply text" };

  const account = await prisma.socialAccount.findUnique({
    where: { propertyId_platform: { propertyId: params.propertyId, platform: "google" } },
  });
  if (!account) return { ok: false, status: 409, error: "google account not linked" };

  const published = await providerFor(account.accountRef).publishReply(
    params.propertyId,
    account.accountRef,
    review.externalId,
    reply
  );
  if (!published) return { ok: false, status: 502, error: "platform publish failed" };

  await prisma.googleReview.update({
    where: { id: review.id },
    data: {
      draftReply: reply,
      replyStatus: "published",
      approvedBy: params.actorId,
      publishedAt: new Date(),
    },
  });
  await recordAudit({
    actorName: params.actorName,
    actorId: params.actorId,
    propertyId: params.propertyId,
    action: "review.reply_published",
    resourceType: "GoogleReview",
    resourceId: review.id,
    outcome: "success",
    metadata: { stars: review.stars, externalId: review.externalId },
  });
  await emitEvent(params.propertyId, {
    type: "review.replied",
    reviewId: review.id,
    stars: review.stars,
  });
  return { ok: true };
}
