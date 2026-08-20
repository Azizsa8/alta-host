import { createWorkflow } from "@mastra/core/workflows";
import { proposeStep } from "../steps/propose.js";
import { reviewGateStep } from "../steps/reviewGate.js";
import { executeStep } from "../steps/execute.js";
import { IntentRunInputSchema, IntentRunResultSchema } from "../schemas.js";

/**
 * One run per extracted intent. Linear by design: the gate is the single
 * decision site for human review, so there is exactly one place to audit
 * when asking "can this reach the PMS without approval?".
 */
export const intentWorkflow = createWorkflow({
  id: "intentWorkflow",
  inputSchema: IntentRunInputSchema,
  outputSchema: IntentRunResultSchema,
})
  .then(proposeStep)
  .then(reviewGateStep)
  .then(executeStep)
  .commit();
