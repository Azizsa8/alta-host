import { createStep } from "@mastra/core/workflows";
import { executeReceptionAction } from "../../agents/receptionAgent.js";
import { executeGuestServiceAction } from "../../agents/guestServiceAgent.js";
import { handleHousekeepingIntent } from "../../agents/housekeepingAgent.js";
import { createPMSAdapter } from "../../pms/mockAdapter.js";
import { sendWhatsAppMessage } from "../../whatsapp/gateway.js";
import { emitEvent } from "../../events/bus.js";
import { GateOutputSchema, IntentRunResultSchema } from "../schemas.js";
import type { ExtractedIntent } from "../../nlu/types.js";
import type { PendingAction } from "../../reviews/reviewService.js";
import { assertActionAllowed } from "../../agents/guards.js";

const pms = createPMSAdapter();

/**
 * Everything with a side effect lives here, downstream of the gate: the
 * PMS mutation, the ticket, and the outbound message. Reaching this step
 * at all means the gate either approved or determined no human was needed.
 */
export const executeStep = createStep({
  id: "execute",
  inputSchema: GateOutputSchema,
  outputSchema: IntentRunResultSchema,
  execute: async ({ inputData }) => {
    if (!inputData.approved) {
      await emitEvent(inputData.propertyId, {
        type: "agent.completed",
        agentKey: inputData.agentKey,
        intentId: inputData.intentId,
        outcome: "queued_for_review",
      });
      return { status: "rejected" as const };
    }

    const ctx = { intentId: inputData.intentId, propertyId: inputData.propertyId };
    let reply = inputData.finalReply;

    if (inputData.agentKey === "housekeeping" || inputData.agentKey === "maintenance") {
      // These agents own their own ticket creation and confirmation wording.
      const intent = {
        type: inputData.intentType,
        params: inputData.params,
        confidence: 1,
      } as ExtractedIntent;
      const result = await handleHousekeepingIntent(intent, {
        ...ctx,
        guestId: inputData.guestId,
        urgency: inputData.urgency,
      });
      reply = result.text;
    } else if (inputData.agentKey === "reception") {
      // §7 guard on the workflow path too — auto-approved runs cannot
      // execute gate-requiring actions any more than the legacy path can.
      assertActionAllowed(
        "reception",
        inputData.pendingAction as PendingAction,
        inputData.autoApprove ? "auto" : "review_approved"
      );
      await executeReceptionAction(
        inputData.pendingAction as PendingAction,
        { ...ctx, urgency: inputData.urgency },
        pms
      );
    } else if (inputData.agentKey === "guest_service") {
      assertActionAllowed(
        "guest_service",
        inputData.pendingAction as PendingAction,
        inputData.autoApprove ? "auto" : "review_approved"
      );
      await executeGuestServiceAction(inputData.pendingAction as PendingAction, ctx);
    }

    if (reply) {
      await sendWhatsAppMessage(inputData.conversationId, reply);
    }

    await emitEvent(inputData.propertyId, {
      type: "agent.completed",
      agentKey: inputData.agentKey,
      intentId: inputData.intentId,
      outcome: "sent",
      replyPreview: reply?.slice(0, 120),
    });

    return { status: "sent" as const, reply };
  },
});
