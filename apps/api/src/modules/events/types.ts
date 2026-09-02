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
  | { type: "workorder.closed"; workOrderId: string; priority: string }
  | { type: "review.fetched"; reviewId: string; stars: number; sentiment: string; topic: string }
  | { type: "review.alert"; reviewId: string; stars: number; topic: string; preview: string }
  | { type: "review.replied"; reviewId: string; stars: number }
  | { type: "content.status"; contentId: string; channel: string; status: string }
  | { type: "content.published"; contentId: string; channel: string; resultUrl: string }
  | { type: "content.failed"; contentId: string; channel: string; error: string }
  | { type: "social.stats"; channel: string; followers: number; reach30d: number }
  | { type: "complaint.captured"; caseId: string; category: string; severity: string; reputationRisk: number }
  | { type: "complaint.reputation_risk"; caseId: string; reputationRisk: number; signals: string[]; preview: string }
  | { type: "complaint.status"; caseId: string; status: string }
  | { type: "social.connected"; channel: string }
  | { type: "brand.render"; renderId: string; status: string };

export type AltaEventType = AltaEventBody["type"];

export interface PublishedEvent {
  seq: string; // BigInt serialized as string
  propertyId: string;
  type: AltaEventType;
  payload: AltaEventBody;
  createdAt: string;
}

export const EVENTS_CHANNEL = "alta:events";
