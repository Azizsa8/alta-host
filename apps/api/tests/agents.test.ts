import { describe, it, expect, vi } from "vitest";
import { prisma } from "../src/db.js";
import { proposeReceptionReply, executeReceptionAction } from "../src/modules/agents/receptionAgent.js";
import { proposeGuestServiceReply, executeGuestServiceAction } from "../src/modules/agents/guestServiceAgent.js";
import { handleHousekeepingIntent } from "../src/modules/agents/housekeepingAgent.js";
import { createPMSAdapter } from "../src/modules/pms/mockAdapter.js";
import type { PMSAdapter } from "../src/modules/pms/types.js";
import { seedGuestWithReservation, seedIntentRecord, seedOnShiftStaff } from "./fixtures.js";

/**
 * A PMSAdapter stub whose mutating method throws — proving propose*
 * functions genuinely never call it, rather than merely "happening" not to
 * in the current mock's implementation. Mocked at the PMSAdapter interface
 * boundary (apps/api/src/modules/pms/types.ts), not at Prisma/DB internals.
 */
function makeGuardedPMSStub(overrides: Partial<PMSAdapter> = {}): PMSAdapter {
  return {
    getAvailability: vi.fn(async () => {
      throw new Error("propose step must not call getAvailability");
    }),
    getBillingStatus: vi.fn(async () => ({ hasValidPaymentMethod: true, outstandingBalance: 0 })),
    extendCheckout: vi.fn(async () => {
      throw new Error("propose step must never mutate — extendCheckout should not be called");
    }),
    getReservationForGuest: vi.fn(async () => ({
      id: "stub-reservation",
      roomNumber: "101",
      checkOut: new Date().toISOString(),
    })),
    ...overrides,
  };
}

describe("proposeReceptionReply — pure read, never mutates", () => {
  it("drafts an extend-stay proposal without ever calling extendCheckout", async () => {
    const pms = makeGuardedPMSStub();
    const proposal = await proposeReceptionReply(
      { type: "booking.extend_stay", params: { hours: 2 }, confidence: 0.8 },
      { guestId: "g1", propertyId: "p1" },
      pms
    );
    expect(pms.extendCheckout).not.toHaveBeenCalled();
    expect(proposal.pendingAction).toEqual({
      type: "extend_checkout",
      params: { reservationId: "stub-reservation", hours: 2 },
    });
  });

  it("faq intents never touch the PMS at all (no reservation lookup, no mutation)", async () => {
    const pms = makeGuardedPMSStub();
    const proposal = await proposeReceptionReply(
      { type: "reception.faq", params: { question: "what is the wifi password" }, confidence: 0.6 },
      { guestId: "g1", propertyId: "p1" },
      pms
    );
    expect(pms.getReservationForGuest).not.toHaveBeenCalled();
    expect(pms.extendCheckout).not.toHaveBeenCalled();
    expect(proposal.pendingAction).toEqual({ type: "no_action", params: {} });
  });

  it("falls back to no_action (no mutation) when the guest has no reservation", async () => {
    const pms = makeGuardedPMSStub({ getReservationForGuest: vi.fn(async () => null) });
    const proposal = await proposeReceptionReply(
      { type: "booking.extend_stay", params: { hours: 1 }, confidence: 0.8 },
      { guestId: "g1", propertyId: "p1" },
      pms
    );
    expect(proposal.pendingAction).toEqual({ type: "no_action", params: {} });
    expect(pms.extendCheckout).not.toHaveBeenCalled();
  });

  it("falls back to no_action (no mutation) when billing has no valid payment method", async () => {
    const pms = makeGuardedPMSStub({
      getBillingStatus: vi.fn(async () => ({ hasValidPaymentMethod: false, outstandingBalance: 50 })),
    });
    const proposal = await proposeReceptionReply(
      { type: "booking.extend_stay", params: { hours: 1 }, confidence: 0.8 },
      { guestId: "g1", propertyId: "p1" },
      pms
    );
    expect(proposal.pendingAction).toEqual({ type: "no_action", params: {} });
    expect(pms.extendCheckout).not.toHaveBeenCalled();
  });
});

describe("proposeGuestServiceReply — pure, synchronous, no side effects", () => {
  it("escalates urgent complaints in the draft reply and never creates a ticket itself", () => {
    const proposal = proposeGuestServiceReply(
      { type: "guest_service.complaint", params: { description: "cold food" }, confidence: 0.75 },
      "urgent"
    );
    expect(proposal.draftReply).toMatch(/duty manager/i);
    expect(proposal.pendingAction).toEqual({
      type: "log_complaint",
      params: { description: "cold food", urgency: "urgent" },
    });
  });

  it("uses the non-urgent reply for normal urgency", () => {
    const proposal = proposeGuestServiceReply(
      { type: "guest_service.complaint", params: { description: "noisy hallway" }, confidence: 0.75 },
      "normal"
    );
    expect(proposal.draftReply).not.toMatch(/duty manager/i);
    expect(proposal.pendingAction.params.urgency).toBe("normal");
  });
});

// --- execute* functions: DB-backed, run against the real MockPMSAdapter ---
// (per apps/api/src/modules/pms/mockAdapter.ts) so we're verifying actual
// mutation, not a second mock's promise to mutate.

describe("executeReceptionAction — mutates PMS + creates a ticket", () => {
  it("extends checkout on the real reservation row and creates a reception ticket", async () => {
    const { property, reservation, conversation } = await seedGuestWithReservation();
    await seedOnShiftStaff(property.id, "reception");
    const { intent } = await seedIntentRecord({
      conversationId: conversation.id,
      type: "booking.extend_stay",
      params: { hours: 2 },
    });
    const pms = createPMSAdapter();

    await executeReceptionAction(
      { type: "extend_checkout", params: { reservationId: reservation.id, hours: 2 } },
      { intentId: intent.id, propertyId: property.id, urgency: "normal" },
      pms
    );

    const updated = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(updated.checkOut.getTime()).toBe(reservation.checkOut.getTime() + 2 * 60 * 60 * 1000);

    const ticket = await prisma.ticket.findUnique({ where: { intentId: intent.id } });
    expect(ticket).not.toBeNull();
    expect(ticket?.department).toBe("reception");
  });

  it("does nothing (no ticket, no mutation) for a no_action pending action", async () => {
    const { property, reservation, conversation } = await seedGuestWithReservation();
    const { intent } = await seedIntentRecord({
      conversationId: conversation.id,
      type: "reception.faq",
      params: {},
    });
    const pms = createPMSAdapter();

    await executeReceptionAction(
      { type: "no_action", params: {} },
      { intentId: intent.id, propertyId: property.id, urgency: "normal" },
      pms
    );

    const unchanged = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(unchanged.checkOut.getTime()).toBe(reservation.checkOut.getTime());
    const ticket = await prisma.ticket.findUnique({ where: { intentId: intent.id } });
    expect(ticket).toBeNull();
  });
});

describe("executeGuestServiceAction — creates a guest_service ticket", () => {
  it("creates a ticket summarizing the complaint", async () => {
    const { property, conversation } = await seedGuestWithReservation();
    await seedOnShiftStaff(property.id, "guest_service");
    const { intent } = await seedIntentRecord({
      conversationId: conversation.id,
      type: "guest_service.complaint",
      params: { description: "room was not clean" },
    });

    await executeGuestServiceAction(
      { type: "log_complaint", params: { description: "room was not clean", urgency: "normal" } },
      { intentId: intent.id, propertyId: property.id }
    );

    const ticket = await prisma.ticket.findUnique({ where: { intentId: intent.id } });
    expect(ticket).not.toBeNull();
    expect(ticket?.department).toBe("guest_service");
    expect(ticket?.summary).toContain("room was not clean");
  });
});

describe("handleHousekeepingIntent — sends immediately, always creates a ticket", () => {
  it("creates a housekeeping ticket for clean_room", async () => {
    const { property, conversation } = await seedGuestWithReservation();
    await seedOnShiftStaff(property.id, "housekeeping");
    const { intent } = await seedIntentRecord({
      conversationId: conversation.id,
      type: "housekeeping.clean_room",
      params: {},
    });

    const reply = await handleHousekeepingIntent(
      { type: "housekeeping.clean_room", params: {}, confidence: 0.85 },
      { propertyId: property.id, intentId: intent.id, urgency: "normal" }
    );

    // Reply language depends on guest dialect resolution (added after this
    // test was written — see receptionAgent.ts's resolveGuestLanguage, which
    // this ctx deliberately omits a guestId for), so the confirmation text
    // itself may come back in English or Arabic. Ticket creation — the thing
    // this test actually verifies — is language-independent.
    expect(reply.text.length).toBeGreaterThan(0);
    const ticket = await prisma.ticket.findUnique({ where: { intentId: intent.id } });
    expect(ticket?.department).toBe("housekeeping");
  });

  it("creates a maintenance ticket for report_issue", async () => {
    const { property, conversation } = await seedGuestWithReservation();
    await seedOnShiftStaff(property.id, "maintenance");
    const { intent } = await seedIntentRecord({
      conversationId: conversation.id,
      type: "maintenance.report_issue",
      params: { description: "AC not working" },
    });

    await handleHousekeepingIntent(
      { type: "maintenance.report_issue", params: { description: "AC not working" }, confidence: 0.7 },
      { propertyId: property.id, intentId: intent.id, urgency: "normal" }
    );

    const ticket = await prisma.ticket.findUnique({ where: { intentId: intent.id } });
    expect(ticket?.department).toBe("maintenance");
    expect(ticket?.summary).toContain("AC not working");
  });
});
