export type IntentType =
  | "booking.extend_stay"
  | "housekeeping.clean_room"
  | "maintenance.report_issue"
  | "guest_service.complaint"
  | "reception.faq";

export interface ExtractedIntent {
  type: IntentType;
  params: Record<string, unknown>;
  confidence: number;
}

export type Sentiment = "positive" | "neutral" | "negative";
export type Urgency = "normal" | "urgent";

export interface IntentEnvelope {
  rawText: string;
  intents: ExtractedIntent[];
  sentiment: Sentiment;
  urgency: Urgency;
}

// The contract every downstream agent consumes — regardless of whether it
// came from the rule-based engine (below) or a future LLM-backed one.
export interface IntentEngine {
  extract(text: string): Promise<IntentEnvelope>;
}
