import { prisma } from "../../db.js";

// FR-10 SLA windows (minutes from ticket creation), by department x urgency.
// Guest-facing departments get the tightest windows; urgent tickets get
// 15-30min across the board; normal back-of-house work gets 2-4h. Phase 1
// defaults, not validated operational thresholds — see docs/PRD.md FR-10.
const SLA_WINDOWS_MINUTES: Record<string, { urgent: number; normal: number }> = {
  guest_service: { urgent: 15, normal: 60 },
  reception: { urgent: 15, normal: 60 },
  housekeeping: { urgent: 30, normal: 120 },
  maintenance: { urgent: 30, normal: 240 },
};

function computeSlaDeadline(department: string, urgency: "normal" | "urgent", from: Date): Date {
  const windows = SLA_WINDOWS_MINUTES[department] ?? SLA_WINDOWS_MINUTES.maintenance;
  const minutes = windows[urgency];
  return new Date(from.getTime() + minutes * 60 * 1000);
}

export async function createTicket(params: {
  intentId: string;
  department: string;
  summary: string;
  propertyId: string;
  urgency: "normal" | "urgent";
}) {
  // Route to whichever staff member for this department is currently on
  // shift — the "route to nearest available housekeeper" behavior from the
  // architecture doc, simplified to "first on-shift match" for the MVP.
  const staff = await prisma.staffMember.findFirst({
    where: { propertyId: params.propertyId, role: params.department, onShift: true },
  });

  const now = new Date();
  const ticket = await prisma.ticket.create({
    data: {
      intentId: params.intentId,
      department: params.department,
      summary: params.summary,
      assignedStaffId: staff?.id,
      slaDeadline: computeSlaDeadline(params.department, params.urgency, now),
    },
  });

  await prisma.agentAction.create({
    data: {
      ticketId: ticket.id,
      agent: params.department,
      action: "ticket.create",
      detail: staff ? `assigned to ${staff.name}` : "no on-shift staff available — unassigned",
    },
  });

  return ticket;
}

export async function logAgentAction(ticketId: string, agent: string, action: string, detail = "") {
  await prisma.agentAction.create({ data: { ticketId, agent, action, detail } });
}

// FR-10: flip escalatedAt exactly once for tickets still open past their
// SLA deadline. The `escalatedAt: null` filter is what makes this
// idempotent — a ticket already flagged is excluded from the update, so
// repeated calls (every /tickets or /metrics read) never overwrite it or
// re-fire a downstream notification for the same breach.
export async function applyPendingEscalations() {
  await prisma.ticket.updateMany({
    where: { status: "open", slaDeadline: { lt: new Date() }, escalatedAt: null },
    data: { escalatedAt: new Date() },
  });
}
