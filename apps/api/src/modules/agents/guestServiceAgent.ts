import { createTicket } from "../tickets/ticketService.js";
import type { ExtractedIntent, Urgency } from "../nlu/types.js";
import type { PendingAction } from "../reviews/reviewService.js";
import { containsArabicScript } from "./receptionAgent.js";

export interface GuestServiceProposal {
  draftReply: string;
  pendingAction: PendingAction;
}

/**
 * Read-only proposal step (FR-4) — drafts the reply, doesn't create the
 * ticket yet. No guest/property context is threaded in here (the orchestrator
 * calls this with just the intent + urgency), so language is picked off the
 * guest's own complaint text — reliable since the NLU engine always carries
 * the raw message through as `description` for this intent.
 */
export function proposeGuestServiceReply(intent: ExtractedIntent, urgency: Urgency): GuestServiceProposal {
  const description = String(intent.params.description ?? "");
  const lang = containsArabicScript(description) ? "ar" : "en";
  const draftReply =
    urgency === "urgent"
      ? lang === "ar"
        ? "آسفين على اللي صار — رفعنا طلبك لمدير المناوبة وبيتواصل وياك في أقرب وقت."
        : "I'm sorry about that — I've escalated this to the duty manager, who will reach out right away."
      : lang === "ar"
        ? "آسفين على الإزعاج، سجّلنا ملاحظتك وبيتابع معك أحد الفريق قريب."
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
  const urgency: Urgency = action.params.urgency === "urgent" ? "urgent" : "normal";
  const urgencyLabel = urgency === "urgent" ? " (URGENT)" : "";
  await createTicket({
    intentId: ctx.intentId,
    department: "guest_service",
    summary: `Complaint${urgencyLabel}: ${description.slice(0, 120)}`,
    propertyId: ctx.propertyId,
    urgency,
  });
}
