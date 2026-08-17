import { describe, it, expect } from "vitest";
import { prisma } from "../src/db.js";
import { createTicket, applyPendingEscalations } from "../src/modules/tickets/ticketService.js";
import { seedGuestWithReservation, seedIntentRecord } from "./fixtures.js";

async function seedTicket(overrides: { department?: string; urgency?: "normal" | "urgent" } = {}) {
  const { property, conversation } = await seedGuestWithReservation();
  const { intent } = await seedIntentRecord({ conversationId: conversation.id, type: "housekeeping.clean_room" });
  const ticket = await createTicket({
    intentId: intent.id,
    department: overrides.department ?? "housekeeping",
    summary: "test ticket",
    propertyId: property.id,
    urgency: overrides.urgency ?? "normal",
  });
  return { property, ticket };
}

describe("createTicket — FR-10 SLA deadline", () => {
  it("computes slaDeadline from department + urgency per the PRD's window table", async () => {
    const cases: Array<{ department: string; urgency: "normal" | "urgent"; minutes: number }> = [
      { department: "guest_service", urgency: "urgent", minutes: 15 },
      { department: "guest_service", urgency: "normal", minutes: 60 },
      { department: "reception", urgency: "urgent", minutes: 15 },
      { department: "reception", urgency: "normal", minutes: 60 },
      { department: "housekeeping", urgency: "urgent", minutes: 30 },
      { department: "housekeeping", urgency: "normal", minutes: 120 },
      { department: "maintenance", urgency: "urgent", minutes: 30 },
      { department: "maintenance", urgency: "normal", minutes: 240 },
    ];

    for (const { department, urgency, minutes } of cases) {
      const before = Date.now();
      const { ticket } = await seedTicket({ department, urgency });
      // slaDeadline is computed from a JS `new Date()` just before the
      // insert, while createdAt comes from Postgres's own `now()` — the two
      // clocks can differ by a millisecond or two, so assert against the
      // call-time window rather than createdAt exactly.
      const deltaMs = ticket.slaDeadline.getTime() - before;
      expect(deltaMs).toBeGreaterThanOrEqual(minutes * 60 * 1000 - 5000);
      expect(deltaMs).toBeLessThanOrEqual(minutes * 60 * 1000 + 5000);
    }
  });
});

describe("applyPendingEscalations — FR-10 escalation sweep", () => {
  it("flags an open ticket whose slaDeadline has passed", async () => {
    const { ticket } = await seedTicket();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { slaDeadline: new Date(Date.now() - 60 * 1000) },
    });

    await applyPendingEscalations();

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.escalatedAt).not.toBeNull();
  });

  it("does not overwrite escalatedAt on a second sweep (one-time transition)", async () => {
    const { ticket } = await seedTicket();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { slaDeadline: new Date(Date.now() - 60 * 1000) },
    });

    await applyPendingEscalations();
    const firstPass = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const firstEscalatedAt = firstPass.escalatedAt;
    expect(firstEscalatedAt).not.toBeNull();

    await applyPendingEscalations();
    const secondPass = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(secondPass.escalatedAt?.getTime()).toBe(firstEscalatedAt?.getTime());
  });

  it("does not flag a ticket whose slaDeadline has not passed yet", async () => {
    const { ticket } = await seedTicket();

    await applyPendingEscalations();

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.escalatedAt).toBeNull();
  });

  it("does not flag a ticket that moved to in_progress before its deadline passed", async () => {
    const { ticket } = await seedTicket();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "in_progress", slaDeadline: new Date(Date.now() - 60 * 1000) },
    });

    await applyPendingEscalations();

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.escalatedAt).toBeNull();
  });
});
