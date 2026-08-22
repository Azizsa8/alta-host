import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { processInboundMessage } from "../src/modules/orchestrator/index.js";
import { findApprovedAnswer, isAgentEnabled, setAgentEnabled } from "../src/modules/knowledge/service.js";
import { assertActionAllowed, ForbiddenAgentActionError } from "../src/modules/agents/guards.js";

/**
 * §6-أ / §7 / §4 مركز الوكلاء acceptance:
 * - agents answer ONLY from approved knowledge (draft/retired invisible)
 * - a disabled agent produces NO AI draft — straight to staff
 * - §7's forbidden column is code that throws, not prose
 */
describe("knowledge base + agent policies (§6-أ / §7)", () => {
  const stamp = Date.now();
  const propertyId = `kb-${stamp}`;
  let guestId = "";
  let conversationId = "";

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "KB Hotel" } });
    const guest = await prisma.guest.create({
      data: { propertyId, whatsappId: `9665kb${stamp}`, name: "ضيف المعرفة", preferredDialect: "saudi" },
    });
    guestId = guest.id;
    const conv = await prisma.conversation.create({ data: { guestId: guest.id } });
    conversationId = conv.id;
  });

  it("draft items do not answer; approving makes them answer; retiring stops them", async () => {
    const item = await prisma.knowledgeItem.create({
      data: {
        propertyId,
        title: "مواعيد المسبح",
        contentAr: "المسبح مفتوح يومياً من ٧ صباحاً حتى ١٠ مساءً.",
        contentEn: "The pool is open daily 7am–10pm.",
        tags: ["مسبح", "pool", "سباحة"],
      },
    });

    // draft → invisible
    expect(await findApprovedAnswer(propertyId, "متى يفتح المسبح؟")).toBeNull();

    await prisma.knowledgeItem.update({ where: { id: item.id }, data: { status: "approved" } });
    const hit = await findApprovedAnswer(propertyId, "متى يفتح المسبح؟");
    expect(hit?.contentAr).toContain("المسبح مفتوح");

    await prisma.knowledgeItem.update({ where: { id: item.id }, data: { status: "retired" } });
    expect(await findApprovedAnswer(propertyId, "متى يفتح المسبح؟")).toBeNull();
  });

  it("the FAQ pipeline drafts from the approved item (§6-أ)", async () => {
    await prisma.knowledgeItem.create({
      data: {
        propertyId,
        title: "الواي فاي",
        contentAr: `شبكة الفندق ALTA-Guest وكلمة المرور على كرت الغرفة. [${stamp}]`,
        tags: ["واي فاي", "wifi", "انترنت"],
        status: "approved",
      },
    });
    const result = await processInboundMessage({
      propertyId,
      guestId,
      conversationId,
      text: `ما هي شبكة الواي فاي؟ ${stamp}`,
    });
    const faq = result.outcomes.find((o) => o.intentType === "reception.faq");
    expect(faq?.status).toBe("queued_for_review");
    const review = await prisma.reviewItem.findFirst({
      where: { intent: { message: { conversationId } } },
      orderBy: { createdAt: "desc" },
    });
    expect(review?.draftReply).toContain("ALTA-Guest");
    expect(review?.draftReply).toContain(String(stamp));
  });

  it("knowledge is tenant-scoped — another property's item never answers", async () => {
    expect(await findApprovedAnswer(`kb-other-${stamp}`, "ما هي شبكة الواي فاي؟")).toBeNull();
  });

  it("a disabled agent produces NO AI draft — straight to staff (§4)", async () => {
    expect(await isAgentEnabled(propertyId, "guest_service")).toBe(true);
    await setAgentEnabled({ propertyId, agentKey: "guest_service", enabled: false, updatedBy: "test" });
    expect(await isAgentEnabled(propertyId, "guest_service")).toBe(false);

    const result = await processInboundMessage({
      propertyId,
      guestId,
      conversationId,
      text: `عندي شكوى على نظافة الغرفة والخدمة سيئة جداً ${stamp}`,
    });
    const complaint = result.outcomes.find((o) => o.intentType === "guest_service.complaint");
    expect(complaint?.status).toBe("queued_for_review");
    expect(complaint?.reply).toBeUndefined();

    const review = await prisma.reviewItem.findFirst({
      where: { department: "guest_service", intent: { message: { conversationId } } },
      orderBy: { createdAt: "desc" },
    });
    expect(review?.draftReply).toBe(""); // no AI draft, on purpose

    const run = await prisma.agentRun.findFirst({
      where: { propertyId, agentKey: "guest_service", policyApplied: "disabled_skipped" },
    });
    expect(run).toBeTruthy();

    // re-enable → the agent drafts again
    await setAgentEnabled({ propertyId, agentKey: "guest_service", enabled: true, updatedBy: "test" });
    const again = await processInboundMessage({
      propertyId,
      guestId,
      conversationId,
      text: `شكوى ثانية الخدمة سيئة ${stamp}`,
    });
    const drafted = again.outcomes.find((o) => o.intentType === "guest_service.complaint");
    expect(drafted?.status).toBe("queued_for_review");
    const review2 = await prisma.reviewItem.findFirst({
      where: { department: "guest_service", intent: { message: { conversationId } } },
      orderBy: { createdAt: "desc" },
    });
    expect(review2?.draftReply.length).toBeGreaterThan(0);
  });

  it("§7 forbidden actions are unrepresentable code, not prose", () => {
    // financial compensation: no agent's allowlist contains it
    expect(() =>
      assertActionAllowed("guest_service", { type: "issue_refund", params: {} }, "review_approved")
    ).toThrow(ForbiddenAgentActionError);
    // cross-guest data access
    expect(() =>
      assertActionAllowed("reception", { type: "read_other_guest", params: {} }, "review_approved")
    ).toThrow(ForbiddenAgentActionError);
    // booking mutation WITHOUT the review gate — allowed action, wrong path
    expect(() => assertActionAllowed("reception", { type: "extend_checkout", params: {} }, "auto")).toThrow(
      /review gate/
    );
    // same action through the gate is fine
    expect(() =>
      assertActionAllowed("reception", { type: "extend_checkout", params: {} }, "review_approved")
    ).not.toThrow();
    // unknown agent key
    expect(() => assertActionAllowed("rogue_agent", { type: "no_action", params: {} }, "auto")).toThrow(
      ForbiddenAgentActionError
    );
  });

  it("agent runs are captured with policy + duration (§9)", async () => {
    const runs = await prisma.agentRun.findMany({ where: { propertyId } });
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const drafted = runs.find((r) => r.policyApplied === "queued_for_review");
    expect(drafted).toBeTruthy();
    expect(drafted!.tenantId).toBe(`tnt-${propertyId}`); // DB trigger derived
  });
});
