import type { PendingAction } from "../reviews/reviewService.js";

/**
 * §7's forbidden column as CODE. Every agent lists the actions it may
 * execute; anything else throws before reaching a PMS adapter or the
 * gateway. The table's forbidden rows — policy invention, booking
 * mutation without the gate, financial compensation, cross-guest data —
 * are unrepresentable: there is no allowlist that contains them.
 */
const ALLOWED_ACTIONS: Record<string, readonly string[]> = {
  reception: ["no_action", "extend_checkout"],
  guest_service: ["no_action", "log_complaint"],
  housekeeping: ["no_action", "create_ticket"],
  maintenance: ["no_action", "create_ticket"],
  concierge_supervisor: ["no_action"],
};

/** Actions that mutate money or bookings — these may ONLY run on the
 *  review-approved path, never auto-approved (§7: "لا تعويض مالي، لا
 *  تعديل حجز دون بوابة"). */
const REVIEW_GATED_ACTIONS = new Set(["extend_checkout"]);

export class ForbiddenAgentActionError extends Error {
  constructor(agentKey: string, action: string, reason: string) {
    super(`agent "${agentKey}" attempted forbidden action "${action}": ${reason}`);
    this.name = "ForbiddenAgentActionError";
  }
}

/**
 * Called at every execute site. `via` states how execution was reached:
 * gate-requiring actions on the auto path throw even when the action is
 * otherwise allowed for the agent.
 */
export function assertActionAllowed(
  agentKey: string,
  action: PendingAction,
  via: "review_approved" | "auto"
): void {
  const allowed = ALLOWED_ACTIONS[agentKey];
  if (!allowed) {
    throw new ForbiddenAgentActionError(agentKey, action.type, "unknown agent");
  }
  if (!allowed.includes(action.type)) {
    throw new ForbiddenAgentActionError(agentKey, action.type, "not in the agent's allowed list (§7)");
  }
  if (via === "auto" && REVIEW_GATED_ACTIONS.has(action.type)) {
    throw new ForbiddenAgentActionError(
      agentKey,
      action.type,
      "booking/financial mutations require the human review gate (§7)"
    );
  }
}
