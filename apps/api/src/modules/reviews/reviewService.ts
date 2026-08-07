import { prisma } from "../../db.js";

export interface PendingAction {
  type: "extend_checkout" | "no_action" | "log_complaint";
  params: Record<string, unknown>;
}

// Queues a drafted agent reply instead of sending it — FR-6. Nothing here
// touches the PMS or creates a ticket; that only happens on approval, via
// the department-specific executor passed back into approveReview.
export async function queueForReview(params: {
  intentId: string;
  department: "reception" | "guest_service";
  draftReply: string;
  pendingAction: PendingAction;
}) {
  return prisma.reviewItem.create({
    data: {
      intentId: params.intentId,
      department: params.department,
      draftReply: params.draftReply,
      pendingAction: JSON.stringify(params.pendingAction),
    },
  });
}

export async function listPendingReviews(propertyId?: string) {
  return prisma.reviewItem.findMany({
    where: {
      status: "pending",
      ...(propertyId
        ? { intent: { message: { conversation: { guest: { propertyId } } } } }
        : {}),
    },
    include: {
      intent: {
        include: { message: { include: { conversation: { include: { guest: true } } } } },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function getReviewItem(id: string) {
  return prisma.reviewItem.findUniqueOrThrow({
    where: { id },
    include: {
      intent: {
        include: { message: { include: { conversation: { include: { guest: true } } } } },
      },
    },
  });
}

export async function markReviewed(id: string, status: "approved" | "rejected", reviewedBy?: string) {
  return prisma.reviewItem.update({
    where: { id },
    data: { status, reviewedBy, reviewedAt: new Date() },
  });
}
