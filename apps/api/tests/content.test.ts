import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import {
  generateIdeas,
  draftFromIdea,
  transitionContent,
  publishContent,
  publishDueContent,
  canTransition,
} from "../src/modules/content/service.js";

/**
 * §6-هـ / §11-7 acceptance: idea → draft → review → approve → schedule →
 * publish recorded with a result link. §7: publication is unreachable
 * without the explicit approval act.
 */
describe("content studio (§6-هـ / §11-7)", () => {
  const stamp = Date.now();
  const propertyId = `cs-${stamp}`;
  const mgr = { staffId: "mkt-1", name: "Dana", propertyId };

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "فندق المحتوى" } });
    await prisma.brandProfile.create({
      data: {
        propertyId,
        identity: "فندق عائلي في قلب الرياض",
        services: ["مسبح خارجي", "سبا", "قاعة اجتماعات"],
        offers: ["خصم ٢٠٪ لنهاية الأسبوع"],
        language: "both",
      },
    });
  });

  it("ideas are grounded in the brand profile", async () => {
    const ideas = await generateIdeas(propertyId);
    expect(ideas.length).toBeGreaterThanOrEqual(5);
    expect(ideas.some((i) => i.includes("خصم ٢٠٪"))).toBe(true);
    expect(ideas.some((i) => i.includes("مسبح خارجي"))).toBe(true);
  });

  it("drafts carry the hotel name and both languages when configured", async () => {
    const draft = await draftFromIdea(propertyId, "إعلان عرض نهاية الأسبوع");
    expect(draft.bodyAr).toContain("فندق المحتوى");
    expect(draft.bodyEn.length).toBeGreaterThan(0);
  });

  it("§7: publish is unreachable without approval", async () => {
    const drafts = await draftFromIdea(propertyId, "منشور تجريبي");
    const item = await prisma.contentItem.create({
      data: { propertyId, idea: "منشور تجريبي", channel: "instagram", status: "draft", ...drafts },
    });

    // straight publish from draft → 422
    const direct = await publishContent({ actor: mgr, contentId: item.id });
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.status).toBe(422);

    // the transition table has no draft→published or in_review→published path
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("in_review", "published")).toBe(false);
    // and the generic transition endpoint refuses "published" entirely
    const sneaky = await transitionContent({ actor: mgr, contentId: item.id, to: "published" });
    expect(sneaky.ok).toBe(false);
  });

  it("the full chain: draft → in_review → approved → scheduled → published with link (§11-7)", async () => {
    const item = await prisma.contentItem.findFirstOrThrow({ where: { propertyId, status: "draft" } });

    expect((await transitionContent({ actor: mgr, contentId: item.id, to: "in_review" })).ok).toBe(true);
    expect((await transitionContent({ actor: mgr, contentId: item.id, to: "approved" })).ok).toBe(true);

    const approved = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(approved.approvedBy).toBe("mkt-1");

    // schedule it in the past so the scheduler tick picks it up
    expect(
      (
        await transitionContent({
          actor: mgr,
          contentId: item.id,
          to: "scheduled",
          scheduledAt: new Date(Date.now() - 1000),
        })
      ).ok
    ).toBe(true);

    const published = await publishDueContent();
    expect(published).toBeGreaterThanOrEqual(1);

    const done = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(done.status).toBe("published");
    expect(done.resultUrl).toContain("mock.social/instagram");
    expect(done.publishedAt).toBeTruthy();
    expect(done.tenantId).toBe(`tnt-${propertyId}`); // DB trigger

    const evt = await prisma.altaEvent.findFirst({ where: { propertyId, type: "content.published" } });
    expect(evt).toBeTruthy();
  });

  it("publish failure → failed status + alert event, retry path open", async () => {
    const drafts = await draftFromIdea(propertyId, "منشور سيفشل [fail]");
    const item = await prisma.contentItem.create({
      data: { propertyId, idea: "منشور سيفشل", channel: "facebook", status: "approved", approvedBy: "mkt-1", ...drafts },
    });
    // the mock rejects bodies containing [fail]
    await prisma.contentItem.update({ where: { id: item.id }, data: { bodyAr: "نص [fail]" } });

    const result = await publishContent({ actor: mgr, contentId: item.id });
    expect(result.ok).toBe(false);

    const failed = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(failed.status).toBe("failed");
    const alert = await prisma.altaEvent.findFirst({ where: { propertyId, type: "content.failed" } });
    expect(alert).toBeTruthy();
    // retry path: failed → scheduled is legal
    expect(canTransition("failed", "scheduled")).toBe(true);
  });

  it("published content is terminal; cross-property access 404s (§11-1)", async () => {
    const done = await prisma.contentItem.findFirstOrThrow({ where: { propertyId, status: "published" } });
    expect(canTransition("published", "draft")).toBe(false);
    const foreign = await transitionContent({
      actor: { staffId: "x", name: "x", propertyId: `cs-other-${stamp}` },
      contentId: done.id,
      to: "in_review",
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.status).toBe(404);
  });
});
