// Event taxonomy for the live ops feed. Names follow the AG-UI convention
// (lifecycle verbs on dotted subjects) so a future protocol adapter is a
// rename, not a redesign.
export type AltaEventBody =
  | { type: "message.received"; conversationId: string; guestId: string; mediaType: "text" | "voice"; preview: string }
  | { type: "intent.extracted"; messageId: string; intents: Array<{ type: string; confidence: number }>; sentiment: string; urgency: string }
  | { type: "agent.started"; agentKey: string; intentId: string; intentType: string; parentKey?: string }
  | { type: "agent.completed"; agentKey: string; intentId: string; outcome: "sent" | "queued_for_review"; replyPreview?: string; parentKey?: string }
  // Sub-agent lifecycle. Distinct from agent.* so the ops view can nest
  // them under their parent instead of flattening the fleet.
  | { type: "subagent.started"; agentKey: string; parentKey: string; intentId: string }
  | { type: "subagent.completed"; agentKey: string; parentKey: string; intentId: string; outcome: "ok" | "blocked"; detail?: string }
  | { type: "conversation.takenover"; conversationId: string; by: string }
  | { type: "conversation.resumed"; conversationId: string; by: string }
  | { type: "review.queued"; reviewItemId: string; department: string; intentId: string }
  | { type: "review.decided"; reviewItemId: string; decision: "approved" | "rejected"; reviewedBy: string }
  | { type: "ticket.created"; ticketId: string; department: string; urgency: string; summary: string }
  | { type: "ticket.escalated"; ticketId: string; department: string }
  | { type: "storage.alert"; usedPct: number; quotaGb: number }
  | { type: "workorder.created"; workOrderId: string; title: string; priority: string; location: string }
  | { type: "workorder.critical"; workOrderId: string; title: string; location: string }
  | { type: "workorder.updated"; workOrderId: string; status: string }
  | { type: "workorder.closed"; workOrderId: string; priority: string };

export type AltaEventType = AltaEventBody["type"];

export interface PublishedEvent {
  seq: string; // BigInt serialized as string
  propertyId: string;
  type: AltaEventType;
  payload: AltaEventBody;
  createdAt: string;
}

export const EVENTS_CHANNEL = "alta:events";
