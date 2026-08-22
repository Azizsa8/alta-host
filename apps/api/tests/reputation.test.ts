import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { syncReviews, approveAndPublish, classifyReview, draftReply } from "../src/modules/reputation/service.js";

/**
 * §6-د / §11-6 acceptance: link (mock) account → reviews fetched and
 * classified → negative/safety alert → reply drafted → human approval is
 * the only path to published (§7: no auto-publish).
 */
describe("Google reviews (§6-د / §11-6)", () => {
  const stamp = Date.now();
  const propertyId = `gbp-${stamp}`;

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "GBP Hotel" } });
    await prisma.socialAccount.create({
      data: { propertyId, platform: "google", accountRef: `mock:${stamp}` },
    });
  });

  it("classifier: safety beats stars; sentiment follows stars", () => {
    expect(classifyReview({ stars: 1, text: "باب الطوارئ مقفل خطر" })).toEqual({ sentiment: "negative", topic: "safety" });
    expect(classifyReview({ stars: 5, text: "الاستقبال ممتاز" })).toEqual({ sentiment: "positive", topic: "staff" });
    expect(classifyReview({ stars: 2, text: "dirty room" }).topic).toBe("cleanliness");
  });

  it("drafts match language and tone", () => {
    expect(draftReply({ stars: 5, text: "فندق رائع", author: "عبدالله السالم" })).toContain("عبدالله");
    expect(draftReply({ stars: 1, text: "terrible stay", author: "James Miller" })).toContain("apologize");
  });

  it("sync fetches, classifies, drafts, and alerts on negative/safety (§6-د)", async () => {
    const result = await syncReviews(propertyId);
    expect(result.new).toBe(4);

    const reviews = await prisma.googleReview.findMany({ where: { propertyId } });
    expect(reviews).toHaveLength(4);
    expect(reviews.every((r) => r.draftReply.length > 0)).toBe(true);
    expect(reviews.every((r) => r.replyStatus === "draft")).toBe(true);

    const safety = reviews.find((r) => r.topic === "safety");
    expect(safety).toBeTruthy();
    expect(safety!.tenantId).toBe(`tnt-${propertyId}`); // DB trigger

    const alerts = await prisma.altaEvent.findMany({ where: { propertyId, type: "review.alert" } });
    // 2-star cleanliness + 1-star safety = exactly two alerts
    expect(alerts).toHaveLength(2);
  });

  it("re-sync is idempotent: no duplicates, no re-alerts", async () => {
    const again = await syncReviews(propertyId);
    expect(again.new).toBe(0);
    expect(await prisma.googleReview.count({ where: { propertyId } })).toBe(4);
    expect(await prisma.altaEvent.count({ where: { propertyId, type: "review.alert" } })).toBe(2);
  });

  it("human approval is the only path to published (§7)", async () => {
    const review = await prisma.googleReview.findFirstOrThrow({ where: { propertyId, topic: "safety" } });
    expect(review.replyStatus).toBe("draft"); // sync never published anything

    const result = await approveAndPublish({
      propertyId,
      reviewId: review.id,
      actorId: "mgr-1",
      actorName: "Reem",
      editedReply: "نعتذر بشدة — عالجنا مشكلة باب الطوارئ فوراً وتم التحقق من جميع المخارج.",
    });
    expect(result.ok).toBe(true);

    const published = await prisma.googleReview.findUniqueOrThrow({ where: { id: review.id } });
    expect(published.replyStatus).toBe("published");
    expect(published.approvedBy).toBe("mgr-1");
    expect(published.draftReply).toContain("عالجنا");

    // double-publish blocked
    const again = await approveAndPublish({ propertyId, reviewId: review.id, actorId: "mgr-1", actorName: "Reem" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(409);
  });

  it("cross-property publish is a 404 (§11-1)", async () => {
    const review = await prisma.googleReview.findFirstOrThrow({ where: { propertyId } });
    const result = await approveAndPublish({
      propertyId: `gbp-other-${stamp}`,
      reviewId: review.id,
      actorId: "x",
      actorName: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
