import { describe, it, expect, vi, afterEach } from "vitest";
import { prisma } from "../src/db.js";
import { processInboundMessage } from "../src/modules/orchestrator/index.js";
import { approveReview, rejectReview } from "../src/modules/reviews/reviewOrchestrator.js";
import { MockPMSAdapter } from "../src/modules/pms/mockAdapter.js";
import { seedGuestWithReservation, seedOnShiftStaff } from "./fixtures.js";

/**
 * The single most safety-critical property in this codebase (per the
 * orchestrator's dispatch() and reviewOrchestrator's approveReview): a PMS
 * mutation or ticket creation must never happen before a human approves the
 * queued item, and must happen exactly once when they do.
 *
 * We spy on MockPMSAdapter.prototype.extendCheckout — the PMSAdapter
 * interface's one mutating method reception intents can trigger — rather
 * than reimplementing a second fake adapter, so we're observing the exact
 * call orchestrator/reviewOrchestrator make against the real adapter both
 * modules instantiate internally (createPMSAdapter() in each file returns
 * its own MockPMSAdapter instance; spying the shared prototype method
 * intercepts calls on either instance without needing to inject anything).
 */
describe("review-queue safety invariant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("booking.extend_stay is queued for review and does NOT mutate the PMS", async () => {
    const { property, guest, reservation, conversation } = await seedGuestWithReservation();
    const extendSpy = vi.spyOn(MockPMSAdapter.prototype, "extendCheckout");

    const result = await processInboundMessage({
      propertyId: property.id,
      guestId: guest.id,
      conversationId: conversation.id,
      text: "Can I get a 2 hour late checkout please?",
    });

    const outcome = result.outcomes.find((o) => o.intentType === "booking.extend_stay");
    expect(outcome?.status).toBe("queued_for_review");
    expect(extendSpy).not.toHaveBeenCalled();

    const stillUnchanged = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(stillUnchanged.checkOut.getTime()).toBe(reservation.checkOut.getTime());
  });

  it("approveReview executes the PMS mutation exactly once, and only after approval", async () => {
    const { property, guest, reservation, conversation } = await seedGuestWithReservation();
    await seedOnShiftStaff(property.id, "reception");
    const extendSpy = vi.spyOn(MockPMSAdapter.prototype, "extendCheckout");

    await processInboundMessage({
      propertyId: property.id,
      guestId: guest.id,
      conversationId: conversation.id,
      text: "Please extend my stay 2 hours",
    });

    // Nothing happened yet — still just a queued item.
    expect(extendSpy).not.toHaveBeenCalled();

    const reviewItem = await prisma.reviewItem.findFirstOrThrow({
      where: { department: "reception", status: "pending", intent: { message: { conversationId: conversation.id } } },
    });

    await approveReview(reviewItem.id, undefined, "test-staff");

    expect(extendSpy).toHaveBeenCalledTimes(1);
    expect(extendSpy).toHaveBeenCalledWith(reservation.id, 2);

    const updated = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(updated.checkOut.getTime()).toBe(reservation.checkOut.getTime() + 2 * 60 * 60 * 1000);

    const approvedItem = await prisma.reviewItem.findUniqueOrThrow({ where: { id: reviewItem.id } });
    expect(approvedItem.status).toBe("approved");

    // Re-approving an already-approved item must throw, and must NOT mutate again.
    await expect(approveReview(reviewItem.id)).rejects.toThrow();
    expect(extendSpy).toHaveBeenCalledTimes(1);
  });

  it("rejectReview never triggers the PMS mutation, ever", async () => {
    const { property, guest, reservation, conversation } = await seedGuestWithReservation();
    const extendSpy = vi.spyOn(MockPMSAdapter.prototype, "extendCheckout");

    await processInboundMessage({
      propertyId: property.id,
      guestId: guest.id,
      conversationId: conversation.id,
      text: "extend my stay 3 hours",
    });

    const reviewItem = await prisma.reviewItem.findFirstOrThrow({
      where: { department: "reception", status: "pending", intent: { message: { conversationId: conversation.id } } },
    });

    await rejectReview(reviewItem.id, "test-staff");

    expect(extendSpy).not.toHaveBeenCalled();
    const unchanged = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(unchanged.checkOut.getTime()).toBe(reservation.checkOut.getTime());

    const rejectedItem = await prisma.reviewItem.findUniqueOrThrow({ where: { id: reviewItem.id } });
    expect(rejectedItem.status).toBe("rejected");

    // A rejected item must never be approve-able after the fact.
    await expect(approveReview(reviewItem.id)).rejects.toThrow();
    expect(extendSpy).not.toHaveBeenCalled();
  });

  it("guest_service.complaint: no ticket is created until approval, exactly one after", async () => {
    const { property, guest, conversation } = await seedGuestWithReservation();
    await seedOnShiftStaff(property.id, "guest_service");

    const result = await processInboundMessage({
      propertyId: property.id,
      guestId: guest.id,
      conversationId: conversation.id,
      text: "This is terrible, I'm very unhappy with the noise",
    });
    const outcome = result.outcomes.find((o) => o.intentType === "guest_service.complaint");
    expect(outcome?.status).toBe("queued_for_review");

    const intentRecord = await prisma.intent.findFirstOrThrow({
      where: { type: "guest_service.complaint", message: { conversationId: conversation.id } },
    });

    // Not executed yet — no ticket.
    let ticket = await prisma.ticket.findUnique({ where: { intentId: intentRecord.id } });
    expect(ticket).toBeNull();

    const reviewItem = await prisma.reviewItem.findFirstOrThrow({ where: { intentId: intentRecord.id } });
    await approveReview(reviewItem.id);

    ticket = await prisma.ticket.findUnique({ where: { intentId: intentRecord.id } });
    expect(ticket).not.toBeNull();
    expect(ticket?.department).toBe("guest_service");

    // Re-approving must throw, and must not create a second ticket.
    await expect(approveReview(reviewItem.id)).rejects.toThrow();
    const ticketCount = await prisma.ticket.count({ where: { intentId: intentRecord.id } });
    expect(ticketCount).toBe(1);
  });

  it("housekeeping/maintenance intents are NOT gated by review (documented low-risk auto-send path)", async () => {
    const { property, guest, conversation } = await seedGuestWithReservation();
    await seedOnShiftStaff(property.id, "housekeeping");

    const result = await processInboundMessage({
      propertyId: property.id,
      guestId: guest.id,
      conversationId: conversation.id,
      text: "please clean my room",
    });

    const outcome = result.outcomes.find((o) => o.intentType === "housekeeping.clean_room");
    expect(outcome?.status).toBe("sent");

    const intentRecord = await prisma.intent.findFirstOrThrow({
      where: { type: "housekeeping.clean_room", message: { conversationId: conversation.id } },
    });
    const ticket = await prisma.ticket.findUnique({ where: { intentId: intentRecord.id } });
    expect(ticket).not.toBeNull();
    const reviewItem = await prisma.reviewItem.findFirst({ where: { intentId: intentRecord.id } });
    expect(reviewItem).toBeNull();
  });
});
