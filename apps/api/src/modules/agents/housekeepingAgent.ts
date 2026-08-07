import { createTicket } from "../tickets/ticketService.js";
import type { ExtractedIntent } from "../nlu/types.js";
import type { AgentReply } from "./receptionAgent.js";

// housekeeping.clean_room and maintenance.report_issue never wait on human
// review in the MVP — no guest-facing risk, per the architecture doc's
// agent roster (03.1: "auto, internal-only").
export async function handleHousekeepingIntent(
  intent: ExtractedIntent,
  ctx: { propertyId: string; intentId: string }
): Promise<AgentReply> {
  const isMaintenance = intent.type === "maintenance.report_issue";
  await createTicket({
    intentId: ctx.intentId,
    department: isMaintenance ? "maintenance" : "housekeeping",
    summary: isMaintenance
      ? `Maintenance: ${String(intent.params.description ?? "").slice(0, 120)}`
      : "Room cleaning requested",
    propertyId: ctx.propertyId,
  });

  return {
    text: isMaintenance
      ? "Thanks for flagging that — maintenance has been notified and is on it."
      : "Housekeeping is on the way.",
  };
}
