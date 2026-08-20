import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { prisma } from "../../../db.js";
import { emitEvent } from "../../events/bus.js";
import { ProposalSchema, GateOutputSchema } from "../schemas.js";

/**
 * The human-in-the-loop boundary — the most safety-critical code in the
 * platform (FR-6).
 *
 * On first execution there is no resumeData, so a guest-facing intent
 * persists a ReviewItem carrying this run's id and then suspends: the
 * workflow physically stops, and executeStep below it is never reached.
 * It only continues when staff approval calls resume() with a decision,
 * which is what makes a PMS mutation structurally unreachable without a
 * human — not merely conventionally avoided.
 */
export const reviewGateStep = createStep({
  id: "review-gate",
  inputSchema: ProposalSchema,
  outputSchema: GateOutputSchema,
  suspendSchema: z.object({ draftReply: z.string(), department: z.string() }),
  resumeSchema: z.object({
    approved: z.boolean(),
    editedReply: z.string().optional(),
    reviewedBy: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend, runId }) => {
    // The single decision site for "does this need a human?". Low-risk
    // departments and explicitly graduated intent types never wait —
    // identical policy to the legacy dispatch switch.
    const needsHuman =
      (inputData.agentKey === "reception" || inputData.agentKey === "guest_service") &&
      !inputData.autoApprove;

    if (!needsHuman) {
      return {
        ...inputData,
        approved: true,
        finalReply: inputData.draftReply ?? "",
        reviewedBy: "auto",
      };
    }

    if (!resumeData) {
      const item = await prisma.reviewItem.create({
        data: {
          intentId: inputData.intentId,
          department: inputData.agentKey,
          draftReply: inputData.draftReply ?? "",
          pendingAction: JSON.stringify(inputData.pendingAction),
          workflowRunId: runId,
        },
      });
      await emitEvent(inputData.propertyId, {
        type: "review.queued",
        reviewItemId: item.id,
        department: inputData.agentKey,
        intentId: inputData.intentId,
      });
      return await suspend({
        draftReply: inputData.draftReply ?? "",
        department: inputData.agentKey,
      });
    }

    return {
      ...inputData,
      approved: resumeData.approved,
      finalReply: resumeData.editedReply?.trim() || inputData.draftReply || "",
      reviewedBy: resumeData.reviewedBy ?? "unknown",
    };
  },
});
