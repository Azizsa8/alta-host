import { LlmIntentEngine } from "./llmEngine.js";
import { RuleBasedIntentEngine } from "./ruleBasedEngine.js";
import type { IntentEngine } from "./types.js";

export * from "./types.js";

// Selects the NLU implementation behind NLU_PROVIDER — defaults to
// "rule_based" so nobody's behavior changes unless they opt in. Everything
// downstream only depends on the IntentEngine interface, not on which
// implementation is behind it (see architecture doc, Layer 02).
export function createIntentEngine(): IntentEngine {
  const provider = process.env.NLU_PROVIDER ?? "rule_based";

  if (provider === "llm") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      return new LlmIntentEngine(apiKey);
    }
    console.warn(
      "NLU_PROVIDER=llm but ANTHROPIC_API_KEY is unset — falling back to RuleBasedIntentEngine. Set ANTHROPIC_API_KEY to use the LLM-backed NLU engine."
    );
  }

  return new RuleBasedIntentEngine();
}
