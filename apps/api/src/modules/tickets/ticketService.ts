import { prisma } from "../../db.js";

export async function createTicket(params: {
  intentId: string;
  department: string;
  summary: string;
  propertyId: string;
}) {
  // Route to whichever staff member for this department is currently on
  // shift — the "route to nearest available housekeeper" behavior from the
  // architecture doc, simplified to "first on-shift match" for the MVP.
  const staff = await prisma.staffMember.findFirst({
    where: { propertyId: params.propertyId, role: params.department, onShift: true },
  });

  const ticket = await prisma.ticket.create({
    data: {
      intentId: params.intentId,
      department: params.department,
      summary: params.summary,
      assignedStaffId: staff?.id,
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
