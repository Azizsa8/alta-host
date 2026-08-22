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
/**
 * The pilot's weekly KPIs (pilot checklist: زمن الاستجابة، نسبة الحل
 * الآلي، رضا النزلاء) computed from what actually happened — message
 * timestamps, agent-run outcomes, sentiment, review stars — over the
 * last 7 days. No self-reported numbers.
 */
async function computeKpis(propertyId: string) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  // First-response time: for each inbound message, the delta to the next
  // outbound in the same conversation. Median beats mean here — one
  // overnight conversation would otherwise swamp a week of fast replies.
  const messages = await prisma.message.findMany({
    where: { conversation: { guest: { propertyId } }, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { conversationId: true, direction: true, createdAt: true },
  });
  const byConv = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = byConv.get(m.conversationId) ?? [];
    list.push(m);
    byConv.set(m.conversationId, list);
  }
  const responseSeconds: number[] = [];
  for (const list of byConv.values()) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].direction !== "inbound") continue;
      const reply = list.slice(i + 1).find((m) => m.direction === "outbound");
      if (reply) responseSeconds.push((reply.createdAt.getTime() - list[i].createdAt.getTime()) / 1000);
    }
  }
  responseSeconds.sort((a, b) => a - b);
  const medianResponseSeconds =
    responseSeconds.length > 0 ? Math.round(responseSeconds[Math.floor(responseSeconds.length / 2)]) : null;

  // Auto-resolution: agent runs that completed without needing a human
  // (enabled / auto_approved) as a share of all runs. disabled_skipped and
  // queued_for_review both count as human-handled — honestly.
  const runs = await prisma.agentRun.groupBy({
    by: ["policyApplied"],
    where: { propertyId, createdAt: { gte: since } },
    _count: true,
  });
  const runCount = (k: string) => runs.find((r) => r.policyApplied === k)?._count ?? 0;
  const autoRuns = runCount("enabled") + runCount("auto_approved");
  const totalRuns = runs.reduce((a, r) => a + r._count, 0);
  const autoResolutionPct = totalRuns > 0 ? Math.round((autoRuns / totalRuns) * 100) : null;

  // Satisfaction: message sentiment share + the public stars average.
  const sentiments = await prisma.intent.groupBy({
    by: ["sentiment"],
    where: { message: { conversation: { guest: { propertyId } } }, createdAt: { gte: since } },
    _count: true,
  });
  const sCount = (k: string) => sentiments.find((r) => r.sentiment === k)?._count ?? 0;
  const sTotal = sentiments.reduce((a, r) => a + r._count, 0);
  const positiveSentimentPct = sTotal > 0 ? Math.round((sCount("positive") / sTotal) * 100) : null;

  const reviews = await prisma.googleReview.aggregate({
    where: { propertyId },
    _avg: { stars: true },
    _count: true,
  });

  // SLA compliance: tickets that never breached their deadline.
  const [totalTickets, breached] = await Promise.all([
    prisma.ticket.count({
      where: { intent: { message: { conversation: { guest: { propertyId } } } }, createdAt: { gte: since } },
    }),
    prisma.ticket.count({
      where: {
        intent: { message: { conversation: { guest: { propertyId } } } },
        createdAt: { gte: since },
        escalatedAt: { not: null },
      },
    }),
  ]);
  const slaCompliancePct = totalTickets > 0 ? Math.round(((totalTickets - breached) / totalTickets) * 100) : null;

  const takeovers = await prisma.conversation.count({
    where: { guest: { propertyId }, takenOverAt: { gte: since } },
  });

  return {
    windowDays: 7,
    medianResponseSeconds,
    respondedCount: responseSeconds.length,
    autoResolutionPct,
    totalRuns,
    positiveSentimentPct,
    googleStarsAvg: reviews._count > 0 ? Math.round((reviews._avg.stars ?? 0) * 10) / 10 : null,
    googleReviewCount: reviews._count,
    slaCompliancePct,
    takeovers,
  };
}

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

  const kpis = await computeKpis(propertyId);

  return {
    propertyId,
    kpis,
    totalTickets: tickets.length,
    ticketsByDepartment,
    sentimentBreakdown,
    urgentCount,
    escalatedCount,
    pendingReviews,
    recommendations,
  };
}
