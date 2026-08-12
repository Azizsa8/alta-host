import { createTicket } from "../tickets/ticketService.js";
import type { ExtractedIntent, Urgency } from "../nlu/types.js";
import { resolveGuestLanguage, type AgentReply } from "./receptionAgent.js";

// housekeeping.clean_room and maintenance.report_issue never wait on human
// review in the MVP — no guest-facing risk, per the architecture doc's
// agent roster (03.1: "auto, internal-only").
export async function handleHousekeepingIntent(
  intent: ExtractedIntent,
  ctx: { propertyId: string; intentId: string; guestId?: string; urgency: Urgency }
): Promise<AgentReply> {
  const isMaintenance = intent.type === "maintenance.report_issue";
  const description = String(intent.params.description ?? "");
  await createTicket({
    intentId: ctx.intentId,
    department: isMaintenance ? "maintenance" : "housekeeping",
    summary: isMaintenance ? `Maintenance: ${description.slice(0, 120)}` : "Room cleaning requested",
    propertyId: ctx.propertyId,
    urgency: ctx.urgency,
  });

  // maintenance reports carry the guest's raw message (a reliable language
  // signal); clean_room requests don't, so fall back to the guest's stored
  // dialect preference when we have a guestId to look it up with.
  const lang = await resolveGuestLanguage(ctx.guestId, isMaintenance ? description : undefined);

  return {
    text: isMaintenance
      ? lang === "ar"
        ? "يعطيك العافية على التنبيه — تم إبلاغ الصيانة وجاري المتابعة."
        : "Thanks for flagging that — maintenance has been notified and is on it."
      : lang === "ar"
        ? "تمام، فريق التنظيف بالطريق إلى غرفتك."
        : "Housekeeping is on the way.",
  };
}
