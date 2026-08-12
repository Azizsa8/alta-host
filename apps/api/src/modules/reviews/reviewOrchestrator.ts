import { createPMSAdapter } from "../pms/mockAdapter.js";
import { executeReceptionAction } from "../agents/receptionAgent.js";
import { executeGuestServiceAction } from "../agents/guestServiceAgent.js";
import { sendWhatsAppMessage } from "../whatsapp/gateway.js";
import { getReviewItem, markReviewed, type PendingAction } from "./reviewService.js";
import { prisma } from "../../db.js";
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
  const pendingAction = JSON.parse(item.pendingAction) as PendingAction;
  const urgency: Urgency = item.intent.urgency === "urgent" ? "urgent" : "normal";
  const execCtx = { intentId: item.intentId, propertyId };

  if (item.department === "reception") {
    await executeReceptionAction(pendingAction, { ...execCtx, urgency }, pms);
  } else if (item.department === "guest_service") {
    await executeGuestServiceAction(pendingAction, execCtx);
  }

  const conversation = await prisma.conversation.findFirst({
    where: { guestId: item.intent.message.conversation.guestId },
    orderBy: { createdAt: "desc" },
  });
  if (conversation) {
    await sendWhatsAppMessage(conversation.id, editedReply?.trim() || item.draftReply);
  }

  return markReviewed(id, "approved", reviewedBy);
}

/** Rejects a queued reply — nothing is sent, no PMS mutation ever occurs. */
export async function rejectReview(id: string, reviewedBy?: string) {
  const item = await getReviewItem(id);
  if (item.status !== "pending") {
    throw new Error(`review item ${id} is already ${item.status}`);
  }
  return markReviewed(id, "rejected", reviewedBy);
}
