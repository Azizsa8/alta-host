import { z } from "zod";

import type { ExtractedIntent, IntentEngine, IntentEnvelope, IntentType, Sentiment, Urgency } from "./types.js";

// Real NLU engine backed by the Anthropic Messages API. Uses plain `fetch`
// (no @anthropic-ai/sdk dependency) so this unit doesn't need to touch
// package-lock.json. Extracts the exact same intent taxonomy the
// rule-based engine supports (see types.ts's IntentType union), plus
// sentiment/urgency, via a single forced tool call — this keeps the model's
// output structured JSON instead of free text we'd have to parse/guess at.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Haiku is the right tier for this — a narrow classification/extraction task,
// not open-ended reasoning. Update this alongside apps/api/.env.example if
// the model is retired; see the model catalog in the claude-api skill.
const MODEL = "claude-haiku-4-5";

const INTENT_TYPES: IntentType[] = [
  "booking.extend_stay",
  "housekeeping.clean_room",
  "maintenance.report_issue",
  "guest_service.complaint",
  "reception.faq",
];

const TOOL_NAME = "extract_guest_intent";

// Schema the model is forced to call, matching IntentEnvelope minus rawText
// (we already know rawText — it's the input — so we don't ask the model to
// echo it back).
const EXTRACT_INTENT_TOOL = {
  name: TOOL_NAME,
  description:
    "Record the intent(s), sentiment, and urgency extracted from a hotel guest's WhatsApp message.",
  input_schema: {
    type: "object",
    properties: {
      intents: {
        type: "array",
        description:
          "Zero or more intents detected in the message. Empty array if none of the supported intents apply.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: INTENT_TYPES,
              description: "The intent category.",
            },
            params: {
              type: "object",
              description:
                "Intent-specific parameters, e.g. { hours: 2 } for booking.extend_stay, { description } for maintenance.report_issue/guest_service.complaint, { question } for reception.faq.",
            },
            confidence: {
              type: "number",
              description: "Confidence between 0 and 1.",
            },
          },
          required: ["type", "params", "confidence"],
        },
      },
      sentiment: {
        type: "string",
        enum: ["positive", "neutral", "negative"],
      },
      urgency: {
        type: "string",
        enum: ["normal", "urgent"],
      },
    },
    required: ["intents", "sentiment", "urgency"],
  },
} as const;

const ExtractedIntentSchema = z.object({
  type: z.enum(["booking.extend_stay", "housekeeping.clean_room", "maintenance.report_issue", "guest_service.complaint", "reception.faq"]),
  params: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).catch(0.5),
});

const ToolInputSchema = z.object({
  intents: z.array(ExtractedIntentSchema).default([]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  urgency: z.enum(["normal", "urgent"]),
});

const SYSTEM_PROMPT = `You are the NLU layer for ALTA, a WhatsApp-first hospitality AI agent used by hotel guests in Saudi Arabia (messages may be in English, Arabic, or transliterated Arabic). Given a guest's message, extract every applicable intent from the supported taxonomy, plus overall sentiment and urgency. Always respond by calling the ${TOOL_NAME} tool — never respond in plain text. If no supported intent applies, call the tool with an empty intents array.`;

interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

interface AnthropicMessagesResponse {
  content: Array<AnthropicToolUseBlock | { type: string; [key: string]: unknown }>;
}

function isToolUseBlock(block: { type: string }): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

export class LlmIntentEngine implements IntentEngine {
  constructor(private readonly apiKey: string) {}

  async extract(text: string): Promise<IntentEnvelope> {
    const fallback: IntentEnvelope = { rawText: text, intents: [], sentiment: "neutral", urgency: "normal" };

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
          tools: [EXTRACT_INTENT_TOOL],
          tool_choice: { type: "tool", name: TOOL_NAME },
        }),
      });
    } catch (error) {
      console.error("LlmIntentEngine: request to Anthropic API failed", error);
      return fallback;
    }

    if (!response.ok) {
      console.error(`LlmIntentEngine: Anthropic API returned ${response.status} ${response.statusText}`);
      return fallback;
    }

    let body: AnthropicMessagesResponse;
    try {
      body = (await response.json()) as AnthropicMessagesResponse;
    } catch (error) {
      console.error("LlmIntentEngine: failed to parse Anthropic API response", error);
      return fallback;
    }

    const toolUseBlock = body.content?.find(isToolUseBlock);
    if (!toolUseBlock) {
      console.error("LlmIntentEngine: no tool_use block in Anthropic API response");
      return fallback;
    }

    const parsed = ToolInputSchema.safeParse(toolUseBlock.input);
    if (!parsed.success) {
      console.error("LlmIntentEngine: tool input failed schema validation", parsed.error.flatten());
      return fallback;
    }

    const intents: ExtractedIntent[] = parsed.data.intents.map((intent) => ({
      type: intent.type,
      params: intent.params,
      confidence: intent.confidence,
    }));
    const sentiment: Sentiment = parsed.data.sentiment;
    const urgency: Urgency = parsed.data.urgency;

    return { rawText: text, intents, sentiment, urgency };
  }
}
