import { prisma } from "../../db.js";
import { createIntentEngine } from "../nlu/index.js";
import { createPMSAdapter } from "../pms/mockAdapter.js";
import { proposeReceptionReply, executeReceptionAction } from "../agents/receptionAgent.js";
import { proposeGuestServiceReply, executeGuestServiceAction } from "../agents/guestServiceAgent.js";
import { handleHousekeepingIntent } from "../agents/housekeepingAgent.js";
import { queueForReview } from "../reviews/reviewService.js";
import { emitEvent } from "../events/bus.js";
import { isMastraOrchestrator } from "../mastra/instance.js";
import { startIntentRun } from "../mastra/runner.js";
import type { ExtractedIntent, Urgency } from "../nlu/types.js";
import { isAgentEnabled, recordAgentRun } from "../knowledge/service.js";
import { assertActionAllowed } from "../agents/guards.js";

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
 * Records an inbound message with no AI processing at all — used while a
 * human has taken the conversation over (§6-ب). The message and its
 * event still appear so staff can reply; nothing is classified or sent.
 */
export async function recordInboundOnly(params: {
  propertyId: string;
  guestId: string;
  conversationId: string;
  text: string;
  mediaType?: "text" | "voice";
}): Promise<void> {
  await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      direction: "inbound",
      rawText: params.text,
      mediaType: params.mediaType ?? "text",
    },
  });
  await emitEvent(params.propertyId, {
    type: "message.received",
    conversationId: params.conversationId,
    guestId: params.guestId,
    mediaType: params.mediaType ?? "text",
    preview: params.text.slice(0, 120),
  });
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

  await emitEvent(params.propertyId, {
    type: "message.received",
    conversationId: params.conversationId,
    guestId: params.guestId,
    mediaType: params.mediaType ?? "text",
    preview: params.text.slice(0, 120),
  });

  const envelope = await intentEngine.extract(params.text);

  await emitEvent(params.propertyId, {
    type: "intent.extracted",
    messageId: message.id,
    intents: envelope.intents.map((i) => ({ type: i.type, confidence: i.confidence })),
    sentiment: envelope.sentiment,
    urgency: envelope.urgency,
  });

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

    const ctx = { guestId: params.guestId, propertyId: params.propertyId, intentId: intentRecord.id, conversationId: params.conversationId };
    const outcome = await dispatch(intent, ctx, envelope.urgency);
    outcomes.push(outcome);
  }

  return { intentEnvelope: envelope, outcomes };
}

function agentKeyFor(intentType: string): string {
  if (intentType.startsWith("maintenance.")) return "maintenance";
  if (intentType.startsWith("housekeeping.")) return "housekeeping";
  if (intentType.startsWith("guest_service.")) return "guest_service";
  if (intentType.startsWith("booking.") || intentType.startsWith("reception.")) return "reception";
  return "concierge_supervisor";
}

async function dispatch(
  intent: ExtractedIntent,
  ctx: { guestId: string; propertyId: string; intentId: string; conversationId: string },
  urgency: Urgency
): Promise<DispatchOutcome> {
  const agentKey = agentKeyFor(intent.type);

  // §4 مركز الوكلاء: a disabled agent produces NO AI draft — the message
  // goes straight to staff via the review queue, empty-handed on purpose.
  if (!(await isAgentEnabled(ctx.propertyId, agentKey))) {
    // queueForReview's department union is reception | guest_service; the
    // low-risk agents fold into guest_service staff handling when disabled.
    const reviewDept = agentKey === "reception" ? ("reception" as const) : ("guest_service" as const);
    const reviewItem = await queueForReview({
      intentId: ctx.intentId,
      department: reviewDept,
      draftReply: "",
      pendingAction: { type: "no_action", params: {} },
    });
    await emitEvent(ctx.propertyId, {
      type: "review.queued",
      reviewItemId: reviewItem.id,
      department: reviewDept,
      intentId: ctx.intentId,
    });
    await recordAgentRun({
      propertyId: ctx.propertyId,
      agentKey,
      intentId: ctx.intentId,
      intentType: intent.type,
      inputs: { params: intent.params },
      policyApplied: "disabled_skipped",
      durationMs: 0,
    });
    return { intentType: intent.type, status: "queued_for_review" };
  }

  // ORCHESTRATOR=mastra routes through the workflow runtime, where the
  // review gate is a durable suspend() rather than a queue-and-return.
  // The workflow emits its own agent.started/completed events.
  if (isMastraOrchestrator()) {
    return startIntentRun({
      propertyId: ctx.propertyId,
      guestId: ctx.guestId,
      conversationId: ctx.conversationId,
      intentId: ctx.intentId,
      intentType: intent.type,
      params: intent.params,
      urgency,
      agentKey,
      autoApprove: AUTO_APPROVE_INTENTS.has(intent.type),
    });
  }

  await emitEvent(ctx.propertyId, {
    type: "agent.started",
    agentKey,
    intentId: ctx.intentId,
    intentType: intent.type,
  });

  const startedAt = Date.now();
  const outcome = await dispatchInner(intent, ctx, urgency);

  // Fire-and-forget: recordAgentRun never throws, and awaiting it would
  // serialize an audit insert into every guest-facing reply.
  void recordAgentRun({
    propertyId: ctx.propertyId,
    agentKey,
    intentId: ctx.intentId,
    intentType: intent.type,
    inputs: { params: intent.params, urgency },
    outputs: { status: outcome.status, replyPreview: outcome.reply?.slice(0, 200) },
    policyApplied: AUTO_APPROVE_INTENTS.has(intent.type) ? "auto_approved" : outcome.status === "queued_for_review" ? "queued_for_review" : "enabled",
    durationMs: Date.now() - startedAt,
  });

  await emitEvent(ctx.propertyId, {
    type: "agent.completed",
    agentKey,
    intentId: ctx.intentId,
    outcome: outcome.status,
    replyPreview: outcome.reply?.slice(0, 120),
  });
  return outcome;
}

async function dispatchInner(
  intent: ExtractedIntent,
  ctx: { guestId: string; propertyId: string; intentId: string; conversationId: string },
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
        // §7: even auto-approved intents cannot execute gate-requiring
        // actions — a booking mutation on the auto path throws here.
        assertActionAllowed("reception", proposal.pendingAction, "auto");
        await executeReceptionAction(proposal.pendingAction, { ...ctx, urgency }, pms);
        return { intentType: intent.type, status: "sent", reply: proposal.draftReply };
      }
      const reviewItem = await queueForReview({
        intentId: ctx.intentId,
        department: "reception",
        draftReply: proposal.draftReply,
        pendingAction: proposal.pendingAction,
      });
      await emitEvent(ctx.propertyId, {
        type: "review.queued",
        reviewItemId: reviewItem.id,
        department: "reception",
        intentId: ctx.intentId,
      });
      return { intentType: intent.type, status: "queued_for_review" };
    }

    case "guest_service.complaint": {
      const proposal = proposeGuestServiceReply(intent, urgency);
      if (AUTO_APPROVE_INTENTS.has(intent.type)) {
        assertActionAllowed("guest_service", proposal.pendingAction, "auto");
        await executeGuestServiceAction(proposal.pendingAction, ctx);
        return { intentType: intent.type, status: "sent", reply: proposal.draftReply };
      }
      const reviewItem = await queueForReview({
        intentId: ctx.intentId,
        department: "guest_service",
        draftReply: proposal.draftReply,
        pendingAction: proposal.pendingAction,
      });
      await emitEvent(ctx.propertyId, {
        type: "review.queued",
        reviewItemId: reviewItem.id,
        department: "guest_service",
        intentId: ctx.intentId,
      });
      return { intentType: intent.type, status: "queued_for_review" };
    }

    default:
      return { intentType: intent.type, status: "sent", reply: "Thanks — I've noted your request." };
  }
}
