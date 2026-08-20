import { getMastra } from "./instance.js";
import { reviewGateStep } from "./steps/reviewGate.js";
import type { IntentRunInput } from "./schemas.js";

export interface IntentRunOutcome {
  intentType: string;
  status: "sent" | "queued_for_review";
  reply?: string;
}

/** Starts one workflow run for a single extracted intent. A guest-facing
 *  intent suspends at the gate and reports queued_for_review; everything
 *  else runs straight through. */
export async function startIntentRun(input: IntentRunInput): Promise<IntentRunOutcome> {
  const workflow = getMastra().getWorkflow("intentWorkflow");
  const run = await workflow.createRun();
  const res = await run.start({ inputData: input });

  if (res.status === "suspended") {
    return { intentType: input.intentType, status: "queued_for_review" };
  }
  const result = (res as { result?: { reply?: string } }).result;
  return { intentType: input.intentType, status: "sent", reply: result?.reply };
}

/** Resumes a suspended run after a staff decision — typically from a
 *  different process than the one that suspended it (webhook worker
 *  suspends; a dashboard HTTP request resumes), which Postgres-backed
 *  storage makes durable across restarts. */
export async function resumeIntentRun(
  runId: string,
  decision: { approved: boolean; editedReply?: string; reviewedBy?: string }
): Promise<void> {
  const workflow = getMastra().getWorkflow("intentWorkflow");
  const run = await workflow.createRun({ runId });
  await run.resume({ step: reviewGateStep, resumeData: decision });
}
