import { prisma } from "../../db.js";
import { createIntentEngine } from "../nlu/index.js";
import { createPMSAdapter } from "../pms/mockAdapter.js";
import { proposeReceptionReply, executeReceptionAction } from "../agents/receptionAgent.js";
import { proposeGuestServiceReply, executeGuestServiceAction } from "../agents/guestServiceAgent.js";
import { handleHousekeepingIntent } from "../agents/housekeepingAgent.js";
import { queueForReview } from "../reviews/reviewService.js";
import type { ExtractedIntent, Urgency } from "../nlu/types.js";

const intentEngine = createIntentEngine();
const pms = createPMSAdapter();

// FR-6/§7.6 — intent types listed here skip the review queue and behave
// like the low-risk agents (immediate send). This is the mechanism for the
// Days 61-90 autonomy graduation; empty by default so Phase 1 always
// reviews reception/guest_service output.
const AUTO_APPROVE_INTENTS = new Set(
  (process.env.AUTO_APPROVE_INTENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

export interface DispatchOutcome {
  intentType: string;
  status: "sent" | "queued_for_review";
  reply?: string;
}

export interface InboundResult {
  intentEnvelope: Awaited<ReturnType<typeof intentEngine.extract>>;
  outcomes: DispatchOutcome[];
}

/**
 * The Executive Manager's dispatch loop: one guest message can carry
 * multiple intents, each routed to its specialist agent independently.
 * Housekeeping/maintenance send immediately; reception/guest_service queue
 * for human review unless explicitly auto-approved (FR-5 vs FR-6).
 */
export async function processInboundMessage(params: {
  propertyId: string;
  guestId: string;
  conversationId: string;
  text: string;
  mediaType?: "text" | "voice";
}): Promise<InboundResult> {
  const message = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      direction: "inbound",
      rawText: params.text,
      mediaType: params.mediaType ?? "text",
    },
  });

  const envelope = await intentEngine.extract(params.text);

  if (envelope.intents.length === 0) {
    return {
      intentEnvelope: envelope,
      outcomes: [{ intentType: "none", status: "sent", reply: "Got it — thanks for the message. A team member will follow up if needed." }],
    };
  }

  const outcomes: DispatchOutcome[] = [];
  for (const intent of envelope.intents) {
    const intentRecord = await prisma.intent.create({
      data: {
        messageId: message.id,
        type: intent.type,
        params: JSON.stringify(intent.params),
        confidence: intent.confidence,
        sentiment: envelope.sentiment,
        urgency: envelope.urgency,
      },
    });

    const ctx = { guestId: params.guestId, propertyId: params.propertyId, intentId: intentRecord.id };
    const outcome = await dispatch(intent, ctx, envelope.urgency);
    outcomes.push(outcome);
  }

  return { intentEnvelope: envelope, outcomes };
}

async function dispatch(
  intent: ExtractedIntent,
  ctx: { guestId: string; propertyId: string; intentId: string },
  urgency: Urgency
): Promise<DispatchOutcome> {
  switch (intent.type) {
    case "housekeeping.clean_room":
    case "maintenance.report_issue": {
      const reply = await handleHousekeepingIntent(intent, { ...ctx, urgency });
      return { intentType: intent.type, status: "sent", reply: reply.text };
    }

    case "booking.extend_stay":
    case "reception.faq": {
      const proposal = await proposeReceptionReply(intent, ctx, pms);
      if (AUTO_APPROVE_INTENTS.has(intent.type)) {
        await executeReceptionAction(proposal.pendingAction, { ...ctx, urgency }, pms);
        return { intentType: intent.type, status: "sent", reply: proposal.draftReply };
      }
      await queueForReview({
        intentId: ctx.intentId,
        department: "reception",
        draftReply: proposal.draftReply,
        pendingAction: proposal.pendingAction,
      });
      return { intentType: intent.type, status: "queued_for_review" };
    }

    case "guest_service.complaint": {
      const proposal = proposeGuestServiceReply(intent, urgency);
      if (AUTO_APPROVE_INTENTS.has(intent.type)) {
        await executeGuestServiceAction(proposal.pendingAction, ctx);
        return { intentType: intent.type, status: "sent", reply: proposal.draftReply };
      }
      await queueForReview({
        intentId: ctx.intentId,
        department: "guest_service",
        draftReply: proposal.draftReply,
        pendingAction: proposal.pendingAction,
      });
      return { intentType: intent.type, status: "queued_for_review" };
    }

    default:
      return { intentType: intent.type, status: "sent", reply: "Thanks — I've noted your request." };
  }
}
