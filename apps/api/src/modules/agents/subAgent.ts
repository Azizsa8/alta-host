import { emitEvent } from "../events/bus.js";

export interface SubAgentContext {
  propertyId: string;
  intentId: string;
}

/**
 * Wraps a real sub-step so it reports itself as a sub-agent.
 *
 * These steps already existed and already gated the outcome — a reception
 * request genuinely dies if there's no reservation, or if there's no valid
 * payment method on file. What was missing is attribution: from outside,
 * one opaque "reception agent" made a decision for reasons nobody could
 * see. Naming each step makes the reasoning inspectable without inventing
 * work that doesn't happen.
 *
 * `blocked` means this step is why the parent stopped, which is exactly
 * the thing a hotel manager asks about when a guest didn't get what they
 * wanted.
 */
export async function runSubAgent<T>(
  ctx: SubAgentContext,
  agentKey: string,
  parentKey: string,
  fn: () => Promise<T>,
  classify?: (result: T) => { outcome: "ok" | "blocked"; detail?: string }
): Promise<T> {
  await emitEvent(ctx.propertyId, {
    type: "subagent.started",
    agentKey,
    parentKey,
    intentId: ctx.intentId,
  });

  try {
    const result = await fn();
    const verdict = classify?.(result) ?? { outcome: "ok" as const };
    await emitEvent(ctx.propertyId, {
      type: "subagent.completed",
      agentKey,
      parentKey,
      intentId: ctx.intentId,
      outcome: verdict.outcome,
      detail: verdict.detail,
    });
    return result;
  } catch (err) {
    await emitEvent(ctx.propertyId, {
      type: "subagent.completed",
      agentKey,
      parentKey,
      intentId: ctx.intentId,
      outcome: "blocked",
      detail: err instanceof Error ? err.message : "failed",
    });
    throw err;
  }
}
