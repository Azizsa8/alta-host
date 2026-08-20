import { z } from "zod";

/** What a single intent run receives. One workflow run per extracted
 *  intent — a multi-intent guest message fans out into several runs. */
export const IntentRunInputSchema = z.object({
  propertyId: z.string(),
  guestId: z.string(),
  conversationId: z.string(),
  intentId: z.string(),
  intentType: z.string(),
  params: z.record(z.unknown()),
  urgency: z.enum(["normal", "urgent"]),
  /** Matches a key in AGENT_REGISTRY — the specialist handling this intent. */
  agentKey: z.string(),
  /** AUTO_APPROVE_INTENTS graduation (FR-6): skip the human gate for this type. */
  autoApprove: z.boolean(),
});

export const PendingActionSchema = z.object({
  type: z.enum(["extend_checkout", "no_action", "log_complaint"]),
  params: z.record(z.unknown()),
});

/** proposeStep output: the input plus a *draft* and a *pending* action.
 *  Nothing here has been sent or mutated yet. */
export const ProposalSchema = IntentRunInputSchema.extend({
  draftReply: z.string().nullable(),
  pendingAction: PendingActionSchema,
});

/** reviewGateStep output: the proposal plus the human decision. */
export const GateOutputSchema = ProposalSchema.extend({
  approved: z.boolean(),
  finalReply: z.string(),
  reviewedBy: z.string(),
});

export const IntentRunResultSchema = z.object({
  status: z.enum(["sent", "queued_for_review", "rejected"]),
  reply: z.string().optional(),
});

export type IntentRunInput = z.infer<typeof IntentRunInputSchema>;
export type IntentRunResult = z.infer<typeof IntentRunResultSchema>;
