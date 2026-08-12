import { prisma } from "../../db.js";
import { applyPendingEscalations } from "../tickets/ticketService.js";

const RECOMMENDATION_KEYWORDS: Array<{ label: string; pattern: RegExp; threshold: number }> = [
  { label: "AC / chiller", pattern: /\b(ac\b|air\s*condition|chiller|مكيف)\b/i, threshold: 2 },
  { label: "Wi-Fi", pattern: /\b(wifi|wi-fi|واي فاي)\b/i, threshold: 2 },
  { label: "water / leak", pattern: /\b(leak|water|تسريب)\b/i, threshold: 2 },
];

/**
 * FR-8 — the Executive Manager's daily report. Aggregates tickets/intents
 * into counts an owner can act on, and generates a plain-language
 * recommendation when a maintenance pattern crosses a threshold — mirrors
 * the PRD's own worked example ("AC complaints up 15% — recommend
 * inspection") rather than just surfacing a raw count.
 */
export async function generateDailyReport(propertyId: string) {
  await applyPendingEscalations();

  const tickets = await prisma.ticket.findMany({
    where: { intent: { message: { conversation: { guest: { propertyId } } } } },
    include: { intent: true },
  });

  const intents = await prisma.intent.findMany({
    where: { message: { conversation: { guest: { propertyId } } } },
  });

  const pendingReviews = await prisma.reviewItem.count({
    where: { status: "pending", intent: { message: { conversation: { guest: { propertyId } } } } },
  });

  const ticketsByDepartment: Record<string, number> = {};
  for (const t of tickets) {
    ticketsByDepartment[t.department] = (ticketsByDepartment[t.department] ?? 0) + 1;
  }

  const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0 } as Record<string, number>;
  for (const i of intents) {
    sentimentBreakdown[i.sentiment] = (sentimentBreakdown[i.sentiment] ?? 0) + 1;
  }
  const urgentCount = intents.filter((i) => i.urgency === "urgent").length;
  // FR-10: only tickets still open past their SLA deadline count as
  // escalated for display — matches the Ticket Board's rule that a ticket
  // moved to done is never flagged, even if escalatedAt was set earlier.
  const escalatedCount = tickets.filter((t) => t.status === "open" && t.escalatedAt).length;

  const maintenanceTickets = tickets.filter((t) => t.department === "maintenance");
  const recommendations: string[] = [];
  for (const { label, pattern, threshold } of RECOMMENDATION_KEYWORDS) {
    const matches = maintenanceTickets.filter((t) => pattern.test(t.summary));
    if (matches.length >= threshold) {
      recommendations.push(
        `${label} complaints have come up ${matches.length} times — recommend an inspection before it compounds.`
      );
    }
  }
  if (urgentCount > 0) {
    recommendations.push(`${urgentCount} urgent guest message(s) logged — check the review queue for anything still pending.`);
  }
  if (escalatedCount > 0) {
    recommendations.push(`${escalatedCount} open ticket(s) have breached their SLA deadline — check the Ticket Board for what's stuck.`);
  }

  return {
    propertyId,
    totalTickets: tickets.length,
    ticketsByDepartment,
    sentimentBreakdown,
    urgentCount,
    escalatedCount,
    pendingReviews,
    recommendations,
  };
}
