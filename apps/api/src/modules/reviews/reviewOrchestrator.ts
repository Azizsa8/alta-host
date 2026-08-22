import { createPMSAdapter } from "../pms/mockAdapter.js";
import { executeReceptionAction } from "../agents/receptionAgent.js";
import { executeGuestServiceAction } from "../agents/guestServiceAgent.js";
import { assertActionAllowed } from "../agents/guards.js";
import { sendWhatsAppMessage } from "../whatsapp/gateway.js";
import { getReviewItem, markReviewed, type PendingAction } from "./reviewService.js";
import { prisma } from "../../db.js";
import { emitEvent } from "../events/bus.js";
import { resumeIntentRun } from "../mastra/runner.js";
import type { Urgency } from "../nlu/types.js";

const pms = createPMSAdapter();

/**
 * Approves a queued reply (FR-6): executes the department-specific
 * mutation (PMS write + ticket creation) exactly once, then sends the
 * final text — the staff-edited version if one was given, otherwise the
 * original draft.
 */
export async function approveReview(id: string, editedReply?: string, reviewedBy?: string) {
  const item = await getReviewItem(id);
  if (item.status !== "pending") {
    throw new Error(`review item ${id} is already ${item.status}`);
  }

  const propertyId = item.intent.message.conversation.guest.propertyId;

  // Mastra-path items carry the suspended run: resuming it is what executes
  // the mutation and sends, inside the workflow, so approval has exactly one
  // meaning regardless of which orchestrator queued the item.
  if (item.workflowRunId) {
    await resumeIntentRun(item.workflowRunId, { approved: true, editedReply, reviewedBy });
    const resumedResult = await markReviewed(id, "approved", reviewedBy);
    await emitEvent(propertyId, {
      type: "review.decided",
      reviewItemId: id,
      decision: "approved",
      reviewedBy: reviewedBy ?? "unknown",
    });
    return resumedResult;
  }

  const pendingAction = JSON.parse(item.pendingAction) as PendingAction;
  const urgency: Urgency = item.intent.urgency === "urgent" ? "urgent" : "normal";
  const execCtx = { intentId: item.intentId, propertyId };

  if (item.department === "reception") {
    assertActionAllowed("reception", pendingAction, "review_approved");
    await executeReceptionAction(pendingAction, { ...execCtx, urgency }, pms);
  } else if (item.department === "guest_service") {
    assertActionAllowed("guest_service", pendingAction, "review_approved");
    await executeGuestServiceAction(pendingAction, execCtx);
  }

  const conversation = await prisma.conversation.findFirst({
    where: { guestId: item.intent.message.conversation.guestId },
    orderBy: { createdAt: "desc" },
  });
  if (conversation) {
    await sendWhatsAppMessage(conversation.id, editedReply?.trim() || item.draftReply);
  }

  const result = await markReviewed(id, "approved", reviewedBy);
  await emitEvent(propertyId, {
    type: "review.decided",
    reviewItemId: id,
    decision: "approved",
    reviewedBy: reviewedBy ?? "unknown",
  });
  return result;
}

/** Rejects a queued reply — nothing is sent, no PMS mutation ever occurs. */
export async function rejectReview(id: string, reviewedBy?: string) {
  const item = await getReviewItem(id);
  if (item.status !== "pending") {
    throw new Error(`review item ${id} is already ${item.status}`);
  }
  // A rejected Mastra run must still be resumed — otherwise it stays
  // suspended in storage forever. approved:false short-circuits execute.
  if (item.workflowRunId) {
    await resumeIntentRun(item.workflowRunId, { approved: false, reviewedBy });
  }

  const result = await markReviewed(id, "rejected", reviewedBy);
  await emitEvent(item.intent.message.conversation.guest.propertyId, {
    type: "review.decided",
    reviewItemId: id,
    decision: "rejected",
    reviewedBy: reviewedBy ?? "unknown",
  });
  return result;
}
