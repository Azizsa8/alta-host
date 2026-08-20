import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { startIntentRun, resumeIntentRun } from "../src/modules/mastra/runner.js";

/**
 * These tests exist to catch a regression in the single most safety-critical
 * behavior in the platform: a guest-facing action must be unreachable
 * without a human decision. If the review gate ever inverts, test 1 fails.
 */
describe("mastra intent workflow — review gate invariant", () => {
  let propertyId: string;
  let guestId: string;
  let conversationId: string;
  let reservationId: string;

  beforeAll(async () => {
    propertyId = `mastra-test-${Date.now()}`;
    await prisma.property.create({
      data: { id: propertyId, name: "Mastra Test Hotel" },
    });
    // Unique per run — the test DB is not reset between runs, and a
    // truncated timestamp collides with earlier rows.
    const guest = await prisma.guest.create({
      data: {
        propertyId,
        whatsappId: `9665${Date.now()}${Math.floor(Math.random() * 1000)}`,
        preferredDialect: "saudi",
      },
    });
    guestId = guest.id;
    const conversation = await prisma.conversation.create({
      data: { guestId, channel: "whatsapp" },
    });
    conversationId = conversation.id;
    const reservation = await prisma.reservation.create({
      data: {
        guestId,
        propertyId,
        roomNumber: "301",
        checkIn: new Date(Date.now() - 86400000),
        checkOut: new Date(Date.now() + 86400000),
        status: "confirmed",
      },
    });
    reservationId = reservation.id;
  });

  async function makeIntent(type: string) {
    const message = await prisma.message.create({
      data: { conversationId, direction: "inbound", rawText: "test", mediaType: "text" },
    });
    return prisma.intent.create({
      data: {
        messageId: message.id,
        type,
        params: "{}",
        confidence: 1,
        sentiment: "neutral",
        urgency: "normal",
      },
    });
  }

  it("suspends a guest-facing intent without mutating the PMS or sending", async () => {
    const intent = await makeIntent("booking.extend_stay");
    const before = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });

    const outcome = await startIntentRun({
      propertyId,
      guestId,
      conversationId,
      intentId: intent.id,
      intentType: "booking.extend_stay",
      params: { hours: 2 },
      urgency: "normal",
      agentKey: "reception",
      autoApprove: false,
    });

    expect(outcome.status).toBe("queued_for_review");

    // A ReviewItem exists and carries the suspended run.
    const item = await prisma.reviewItem.findFirstOrThrow({ where: { intentId: intent.id } });
    expect(item.workflowRunId).toBeTruthy();
    expect(item.status).toBe("pending");

    // Nothing was mutated and nothing was sent.
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(after.checkOut.getTime()).toBe(before.checkOut.getTime());
    const outbound = await prisma.message.count({
      where: { conversationId, direction: "outbound" },
    });
    expect(outbound).toBe(0);
  });

  it("rejecting completes the run without mutating anything", async () => {
    const intent = await makeIntent("guest_service.complaint");
    const outcome = await startIntentRun({
      propertyId,
      guestId,
      conversationId,
      intentId: intent.id,
      intentType: "guest_service.complaint",
      params: { description: "noisy neighbours" },
      urgency: "normal",
      agentKey: "guest_service",
      autoApprove: false,
    });
    expect(outcome.status).toBe("queued_for_review");

    const item = await prisma.reviewItem.findFirstOrThrow({ where: { intentId: intent.id } });
    await resumeIntentRun(item.workflowRunId!, { approved: false, reviewedBy: "tester" });

    // Rejection creates no ticket for this intent.
    const tickets = await prisma.ticket.count({ where: { intentId: intent.id } });
    expect(tickets).toBe(0);
  });

  it("approving executes the PMS mutation exactly once with the edited text", async () => {
    const intent = await makeIntent("booking.extend_stay");
    await startIntentRun({
      propertyId,
      guestId,
      conversationId,
      intentId: intent.id,
      intentType: "booking.extend_stay",
      params: { hours: 2 },
      urgency: "normal",
      agentKey: "reception",
      autoApprove: false,
    });

    const item = await prisma.reviewItem.findFirstOrThrow({ where: { intentId: intent.id } });
    const before = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });

    await resumeIntentRun(item.workflowRunId!, {
      approved: true,
      editedReply: "Approved — your checkout is now 2pm.",
      reviewedBy: "tester",
    });

    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(after.checkOut.getTime()).toBeGreaterThan(before.checkOut.getTime());

    const outbound = await prisma.message.findMany({
      where: { conversationId, direction: "outbound" },
    });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].rawText).toBe("Approved — your checkout is now 2pm.");
  });

  it("a low-risk intent never suspends — it runs straight through", async () => {
    const intent = await makeIntent("housekeeping.clean_room");
    const outcome = await startIntentRun({
      propertyId,
      guestId,
      conversationId,
      intentId: intent.id,
      intentType: "housekeeping.clean_room",
      params: {},
      urgency: "normal",
      agentKey: "housekeeping",
      autoApprove: false,
    });

    expect(outcome.status).toBe("sent");
    const reviewItems = await prisma.reviewItem.count({ where: { intentId: intent.id } });
    expect(reviewItems).toBe(0);
    const tickets = await prisma.ticket.count({ where: { intentId: intent.id } });
    expect(tickets).toBe(1);
  });
});
