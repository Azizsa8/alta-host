import { recordAgentRun } from "../knowledge/service.js";
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
  const startedAt = Date.now();
  const workflow = getMastra().getWorkflow("intentWorkflow");
  const run = await workflow.createRun();
  const res = await run.start({ inputData: input });

  // A failed run means a step threw — including the §7 guard refusing a
  // forbidden action. Swallowing it as "sent" would report success for a
  // reply that never went out.
  if (res.status === "failed") {
    const err = (res as { error?: unknown }).error;
    if (err instanceof Error) throw err;
    const msg =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : JSON.stringify(err ?? "workflow failed");
    throw new Error(msg);
  }

  const suspended = res.status === "suspended";
  const result = suspended ? undefined : (res as { result?: { reply?: string } }).result;

  // §9 run capture — same record shape as the legacy dispatcher, so the
  // agent centre's run log doesn't care which orchestrator ran.
  void recordAgentRun({
    propertyId: input.propertyId,
    agentKey: input.agentKey,
    intentId: input.intentId,
    intentType: input.intentType,
    inputs: { params: input.params, urgency: input.urgency },
    outputs: { status: suspended ? "queued_for_review" : "sent", replyPreview: result?.reply?.slice(0, 200) },
    policyApplied: input.autoApprove ? "auto_approved" : suspended ? "queued_for_review" : "enabled",
    durationMs: Date.now() - startedAt,
  });

  if (suspended) {
    return { intentType: input.intentType, status: "queued_for_review" };
  }
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
