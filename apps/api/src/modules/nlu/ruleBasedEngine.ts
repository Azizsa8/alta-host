import type { ExtractedIntent, IntentEngine, IntentEnvelope, Sentiment, Urgency } from "./types.js";

// Placeholder for the real NLU pipeline described in the architecture doc
// (Gulf-dialect ASR + LLM-based multi-intent extraction + sentiment model).
// This keeps the MVP runnable with zero external API keys, and implements
// the exact same IntentEngine interface an LLM-backed engine will — so
// swapping it in later is a one-line change in index.ts, not a rewrite of
// every agent that consumes IntentEnvelope.
//
// Deliberately narrow: covers the intents named in the source docs
// (extend stay, clean room, maintenance issue, complaint, FAQ) via keyword
// matching in both English and transliterated/Arabic-script phrasing.

const EXTEND_STAY_HOURS = /(\d+)\s*-?\s*(?:hour|hr|ساعة|ساعتين|ساعات)/i;
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

function detectExtendStay(text: string): ExtractedIntent | null {
  const mentionsExtend = /(extend|late\s*check-?out|أمدد|امدد|تمديد|تأخير.*خروج)/i.test(text);
  if (!mentionsExtend) return null;

  const hoursMatch = text.match(EXTEND_STAY_HOURS);
  const wordMatch = text.match(/(one|two|three|four)\s*-?\s*hour/i);
  const hours = hoursMatch
    ? Number(hoursMatch[1])
    : wordMatch
      ? WORD_NUMBERS[wordMatch[1].toLowerCase()]
      : text.includes("ساعتين")
        ? 2
        : 1;
  return { type: "booking.extend_stay", params: { hours }, confidence: 0.8 };
}

function detectCleanRoom(text: string): ExtractedIntent | null {
  const mentions = /(clean(?:ing)?\s*(?:my\s*|the\s*)?room|room\s*clean(?:ing)?|تنظيف|نظف|تنظف)/i.test(text);
  if (!mentions) return null;
  return { type: "housekeeping.clean_room", params: {}, confidence: 0.85 };
}

function detectMaintenanceIssue(text: string): ExtractedIntent | null {
  const mentions = /(leak|broken|not working|ac\b|air\s*condition|عطل|تسريب|مكيف|خراب|لا يعمل)/i.test(text);
  if (!mentions) return null;
  return { type: "maintenance.report_issue", params: { description: text }, confidence: 0.7 };
}

function detectComplaint(text: string): ExtractedIntent | null {
  // Arabic negativity carries gender and hamza variants: matching only
  // "سيء" missed "سيئة"/"سيئه", which is how guests actually write it, and
  // a missed complaint means the reputation case is never opened at all.
  const mentions =
    /(complain|unhappy|disappointed|terrible|awful|rude|dirty|مستاء|شكوى|سيئ|سيء|وسخ|متسخ|قذر|أزعجني|مزعج|غير محترم|زعلان|أسوأ)/i.test(
      text
    );
  if (!mentions) return null;
  return { type: "guest_service.complaint", params: { description: text }, confidence: 0.75 };
}

function detectFaq(text: string): ExtractedIntent | null {
  const mentions = /(wifi|wi-fi|password|breakfast|check-?in time|واي فاي|كلمة المرور|فطور|موعد الدخول)/i.test(text);
  if (!mentions) return null;
  return { type: "reception.faq", params: { question: text }, confidence: 0.6 };
}

function detectSentiment(text: string): { sentiment: Sentiment; urgency: Urgency } {
  const angry = /(angry|furious|unacceptable|terrible|awful|غاضب|زعلان|مستفز|غير مقبول|!!!|urgent|فورا|حالا)/i.test(
    text
  );
  const negative = /(bad|disappointed|unhappy|complain|سيء|مستاء|شكوى)/i.test(text);
  if (angry) return { sentiment: "negative", urgency: "urgent" };
  if (negative) return { sentiment: "negative", urgency: "normal" };
  return { sentiment: "neutral", urgency: "normal" };
}

export class RuleBasedIntentEngine implements IntentEngine {
  async extract(text: string): Promise<IntentEnvelope> {
    const detectors = [detectExtendStay, detectCleanRoom, detectMaintenanceIssue, detectComplaint, detectFaq];
    const intents = detectors.map((detect) => detect(text)).filter((i): i is ExtractedIntent => i !== null);
    const { sentiment, urgency } = detectSentiment(text);

    return { rawText: text, intents, sentiment, urgency };
  }
}
