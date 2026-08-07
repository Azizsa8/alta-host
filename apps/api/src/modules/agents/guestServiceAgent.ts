import { createTicket } from "../tickets/ticketService.js";
import type { ExtractedIntent, Urgency } from "../nlu/types.js";
import type { PendingAction } from "../reviews/reviewService.js";

export interface GuestServiceProposal {
  draftReply: string;
  pendingAction: PendingAction;
}

/** Read-only proposal step (FR-4) — drafts the reply, doesn't create the ticket yet. */
export function proposeGuestServiceReply(intent: ExtractedIntent, urgency: Urgency): GuestServiceProposal {
  const description = String(intent.params.description ?? "");
  const draftReply =
    urgency === "urgent"
      ? "I'm sorry about that — I've escalated this to the duty manager, who will reach out right away."
      : "I'm sorry to hear that. I've logged this and a team member will follow up shortly.";

  return {
    draftReply,
    pendingAction: { type: "log_complaint", params: { description, urgency } },
  };
}

/** Executes the ticket creation a proposal described — only called after human approval. */
export async function executeGuestServiceAction(
  action: PendingAction,
  ctx: { intentId: string; propertyId: string }
): Promise<void> {
  if (action.type !== "log_complaint") return;
  const description = String(action.params.description ?? "");
  const urgency = action.params.urgency === "urgent" ? " (URGENT)" : "";
  await createTicket({
    intentId: ctx.intentId,
    department: "guest_service",
    summary: `Complaint${urgency}: ${description.slice(0, 120)}`,
    propertyId: ctx.propertyId,
  });
}
