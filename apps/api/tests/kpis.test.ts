import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { generateDailyReport } from "../src/modules/reports/dailyReport.js";

/**
 * Pilot KPIs (زمن الاستجابة، نسبة الحل الآلي، رضا النزلاء، الالتزام
 * بالمهل): computed from real rows, verified against hand-built data
 * where every expected number is derivable by inspection.
 */
describe("pilot KPIs in the executive report", () => {
  const stamp = Date.now();
  const propertyId = `kpi-${stamp}`;
  let conversationId = "";

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "KPI Hotel" } });
    const guest = await prisma.guest.create({
      data: { propertyId, whatsappId: `9665kpi${stamp}`, name: "نزيل" },
    });
    const conv = await prisma.conversation.create({
      data: { guestId: guest.id, takenOverAt: new Date() }, // one takeover in-window
    });
    conversationId = conv.id;

    // Two inbound→outbound pairs with known deltas: 10s and 30s → median 30
    // (upper median of [10, 30] at index 1).
    const t0 = Date.now() - 3600_000;
    await prisma.message.createMany({
      data: [
        { conversationId, direction: "inbound", rawText: "أول رسالة", createdAt: new Date(t0) },
        { conversationId, direction: "outbound", rawText: "أول رد", createdAt: new Date(t0 + 10_000) },
        { conversationId, direction: "inbound", rawText: "ثاني رسالة", createdAt: new Date(t0 + 60_000) },
        { conversationId, direction: "outbound", rawText: "ثاني رد", createdAt: new Date(t0 + 90_000) },
      ],
    });

    // Agent runs: 3 auto-handled, 1 human-queued → 75% auto-resolution.
    await prisma.agentRun.createMany({
      data: [
        { propertyId, agentKey: "maintenance", intentType: "maintenance.report_issue", policyApplied: "enabled" },
        { propertyId, agentKey: "housekeeping", intentType: "housekeeping.clean_room", policyApplied: "enabled" },
        { propertyId, agentKey: "reception", intentType: "reception.faq", policyApplied: "auto_approved" },
        { propertyId, agentKey: "reception", intentType: "booking.extend_stay", policyApplied: "queued_for_review" },
      ],
    });

    // Google stars: 5 and 2 → 3.5 average.
    await prisma.googleReview.createMany({
      data: [
        { propertyId, externalId: `k1-${stamp}`, stars: 5, text: "ممتاز", author: "أ", reviewedAt: new Date() },
        { propertyId, externalId: `k2-${stamp}`, stars: 2, text: "سيء", author: "ب", reviewedAt: new Date() },
      ],
    });
  });

  it("computes every KPI from the hand-built data", async () => {
    const report = await generateDailyReport(propertyId);
    const k = report.kpis;

    expect(k.respondedCount).toBe(2);
    expect(k.medianResponseSeconds).toBe(30);
    expect(k.autoResolutionPct).toBe(75);
    expect(k.totalRuns).toBe(4);
    expect(k.googleStarsAvg).toBe(3.5);
    expect(k.googleReviewCount).toBe(2);
    expect(k.takeovers).toBe(1);
    expect(k.windowDays).toBe(7);
  });

  it("empty hotels report null, not fake zeros", async () => {
    const emptyId = `kpi-empty-${stamp}`;
    await prisma.property.create({ data: { id: emptyId, name: "Empty Hotel" } });
    const report = await generateDailyReport(emptyId);
    // 0% auto-resolution would read as "the AI never works"; null reads as
    // "no data yet" — the honest answer for a hotel with no traffic.
    expect(report.kpis.medianResponseSeconds).toBeNull();
    expect(report.kpis.autoResolutionPct).toBeNull();
    expect(report.kpis.slaCompliancePct).toBeNull();
    expect(report.kpis.googleStarsAvg).toBeNull();
  });
});
