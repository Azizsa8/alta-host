import { createStep } from "@mastra/core/workflows";
import { proposeReceptionReply } from "../../agents/receptionAgent.js";
import { proposeGuestServiceReply } from "../../agents/guestServiceAgent.js";
import { createPMSAdapter } from "../../pms/mockAdapter.js";
import { emitEvent } from "../../events/bus.js";
import { IntentRunInputSchema, ProposalSchema } from "../schemas.js";
import type { ExtractedIntent } from "../../nlu/types.js";

const pms = createPMSAdapter();

/**
 * Read-only: builds the draft reply and the *pending* action by delegating
 * to the same propose* functions the legacy path uses, so agent wording
 * lives in exactly one place. Nothing here may mutate the PMS or send
 * anything — that is executeStep's job, and only past the gate.
 */
export const proposeStep = createStep({
  id: "propose",
  inputSchema: IntentRunInputSchema,
  outputSchema: ProposalSchema,
  execute: async ({ inputData }) => {
    await emitEvent(inputData.propertyId, {
      type: "agent.started",
      agentKey: inputData.agentKey,
      intentId: inputData.intentId,
      intentType: inputData.intentType,
    });

    const ctx = {
      guestId: inputData.guestId,
      propertyId: inputData.propertyId,
      intentId: inputData.intentId,
    };
    const intent = {
      type: inputData.intentType,
      params: inputData.params,
      confidence: 1,
    } as ExtractedIntent;

    if (inputData.agentKey === "reception") {
      const p = await proposeReceptionReply(intent, ctx, pms);
      return { ...inputData, draftReply: p.draftReply, pendingAction: p.pendingAction };
    }
    if (inputData.agentKey === "guest_service") {
      const p = proposeGuestServiceReply(intent, inputData.urgency);
      return { ...inputData, draftReply: p.draftReply, pendingAction: p.pendingAction };
    }

    // housekeeping / maintenance: no guest-facing decision to review, so
    // there is nothing to draft — executeStep handles them directly.
    return {
      ...inputData,
      draftReply: null,
      pendingAction: { type: "no_action" as const, params: {} },
    };
  },
});
