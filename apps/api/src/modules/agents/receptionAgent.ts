import type { PMSAdapter } from "../pms/types.js";
import { createTicket, logAgentAction } from "../tickets/ticketService.js";
import type { ExtractedIntent } from "../nlu/types.js";
import type { PendingAction } from "../reviews/reviewService.js";

export interface AgentReply {
  text: string;
}

export interface ReceptionProposal {
  draftReply: string;
  pendingAction: PendingAction;
}

/**
 * Read-only proposal step (FR-3): checks PMS state and drafts a reply, but
 * never mutates anything. The result is what goes into the review queue —
 * the actual PMS write happens only in executeReceptionAction, on approval.
 */
export async function proposeReceptionReply(
  intent: ExtractedIntent,
  ctx: { guestId: string; propertyId: string },
  pms: PMSAdapter
): Promise<ReceptionProposal> {
  if (intent.type === "reception.faq") {
    const question = String(intent.params.question ?? "").toLowerCase();
    const answer = /wifi|واي فاي/.test(question)
      ? "The Wi-Fi network is ALTA-Guest, password is on your room key card."
      : /breakfast|فطور/.test(question)
        ? "Breakfast is served 6:30–10:30 AM in the main restaurant."
        : "Thanks for reaching out — a team member will confirm shortly.";
    return { draftReply: answer, pendingAction: { type: "no_action", params: {} } };
  }

  const hours = Number(intent.params.hours ?? 1);
  const reservation = await pms.getReservationForGuest(ctx.guestId);
  if (!reservation) {
    return {
      draftReply: "I couldn't find an active reservation for you — could you confirm your room number?",
      pendingAction: { type: "no_action", params: {} },
    };
  }

  const billing = await pms.getBillingStatus(ctx.guestId);
  if (!billing.hasValidPaymentMethod) {
    return {
      draftReply: "Late checkout needs a valid payment method on file — please check in with the front desk.",
      pendingAction: { type: "no_action", params: {} },
    };
  }

  const proposedCheckout = new Date(new Date(reservation.checkOut).getTime() + hours * 60 * 60 * 1000);
  return {
    draftReply: `Confirmed — late checkout extended to ${proposedCheckout.toLocaleTimeString()}.`,
    pendingAction: {
      type: "extend_checkout",
      params: { reservationId: reservation.id, hours },
    },
  };
}

/** Executes the mutation a proposal described — only called after human approval. */
export async function executeReceptionAction(
  action: PendingAction,
  ctx: { intentId: string; propertyId: string },
  pms: PMSAdapter
): Promise<void> {
  if (action.type !== "extend_checkout") return; // no_action needs no execution

  const reservationId = String(action.params.reservationId);
  const hours = Number(action.params.hours);
  const result = await pms.extendCheckout(reservationId, hours);

  const ticket = await createTicket({
    intentId: ctx.intentId,
    department: "reception",
    summary: `Extend checkout for reservation ${reservationId} by ${hours}h`,
    propertyId: ctx.propertyId,
  });
  await logAgentAction(ticket.id, "reception", "pms.extendCheckout", `new checkout: ${result.newCheckOut}`);
}
