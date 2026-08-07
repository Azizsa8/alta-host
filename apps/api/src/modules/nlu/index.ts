import { RuleBasedIntentEngine } from "./ruleBasedEngine.js";
import type { IntentEngine } from "./types.js";

export * from "./types.js";

export function createIntentEngine(): IntentEngine {
  // Swap in an LLM-backed engine here once ASR + dialect-tuned NLU are wired
  // up (see architecture doc, Layer 02). Everything downstream only depends
  // on the IntentEngine interface, not on this implementation.
  return new RuleBasedIntentEngine();
}
