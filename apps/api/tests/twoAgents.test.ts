import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { AGENT_REGISTRY } from "../src/modules/agents/registry.js";
import { assertActionAllowed } from "../src/modules/agents/guards.js";
import { can } from "../src/modules/auth/permissions.js";
import { isAgentEnabled, setAgentEnabled } from "../src/modules/knowledge/service.js";
import { CHANNEL_CATALOGUE } from "../src/modules/social/catalogue.js";
import {
  listChannels,
  updateChannel,
  generateForChannel,
  channelCalendar,
  channelAnalytics,
} from "../src/modules/social/service.js";
import {
  triageComplaint,
  captureComplaint,
  recordRca,
  updateCase,
  complaintPatterns,
  proposeActions,
} from "../src/modules/complaints/service.js";

/**
 * The two agents added to the fleet: a multi-channel social media manager
 * and a complaint/reputation manager that catches a complaint before it
 * becomes a public review. Both must be wired the same way every other
 * agent is — registry, on/off policy, §7 allowlist, role permissions.
 */
describe("social media manager + complaint manager", () => {
  const stamp = Date.now();
  const propertyId = `agents-${stamp}`;
  const actor = { staffId: "mgr-1", name: "Reem", propertyId };

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "Two Agents Hotel" } });
    await prisma.brandProfile.create({
      data: {
        propertyId,
        identity: "فندق بوتيك في الرياض",
        services: ["مسبح", "سبا", "قاعة اجتماعات"],
        offers: ["عرض نهاية الأسبوع ٢٥٪"],
        language: "both",
      },
    });
  });

  /* ── wiring: both agents behave like every other agent ────────────── */

  it("both agents are in the registry with their sub-agents", () => {
    const keys = AGENT_REGISTRY.map((a) => a.key);
    expect(keys).toContain("social_media");
    expect(keys).toContain("complaint_manager");
    // sub-agents point at the right parents, so the ops-centre tree renders
    const social = AGENT_REGISTRY.filter((a) => a.parent === "social_media");
    const complaint = AGENT_REGISTRY.filter((a) => a.parent === "complaint_manager");
    expect(social.map((a) => a.key)).toEqual(["social_calendar", "social_analytics"]);
    expect(complaint.map((a) => a.key)).toEqual(["complaint_triage", "complaint_rca"]);
    expect(social.every((a) => a.depth === 2)).toBe(true);
    expect(complaint.every((a) => a.depth === 2)).toBe(true);
  });

  it("both agents respect the on/off switch like every other agent", async () => {
    expect(await isAgentEnabled(propertyId, "social_media")).toBe(true);
    await setAgentEnabled({ propertyId, agentKey: "social_media", enabled: false, updatedBy: "test" });
    expect(await isAgentEnabled(propertyId, "social_media")).toBe(false);
    await setAgentEnabled({ propertyId, agentKey: "social_media", enabled: true, updatedBy: "test" });

    await setAgentEnabled({ propertyId, agentKey: "complaint_manager", enabled: false, updatedBy: "test" });
    expect(await isAgentEnabled(propertyId, "complaint_manager")).toBe(false);
    await setAgentEnabled({ propertyId, agentKey: "complaint_manager", enabled: true, updatedBy: "test" });
  });

  it("§7 holds for both: no publishing, no money", () => {
    // The social manager drafts and schedules; it cannot publish on its own.
    expect(() => assertActionAllowed("social_media", { type: "draft_content", params: {} }, "auto")).not.toThrow();
    expect(() => assertActionAllowed("social_media", { type: "publish_post", params: {} }, "review_approved")).toThrow();
    // Scheduling is gate-requiring: it cannot run on the auto path.
    expect(() => assertActionAllowed("social_media", { type: "schedule_content", params: {} }, "auto")).toThrow(/review gate/);
    // The complaint manager may never offer money to placate a guest.
    expect(() => assertActionAllowed("complaint_manager", { type: "issue_refund", params: {} }, "review_approved")).toThrow();
    expect(() => assertActionAllowed("complaint_manager", { type: "open_case", params: {} }, "auto")).not.toThrow();
  });

  it("permissions: marketing runs channels, only managers close a case", () => {
    expect(can("marketing_manager", "social.manage")).toBe(true);
    expect(can("reception", "social.manage")).toBe(false);
    expect(can("reception", "social.view")).toBe(true);
    expect(can("marketing_manager", "complaints.investigate")).toBe(true);
    expect(can("marketing_manager", "complaints.resolve")).toBe(false); // closing is a manager act
    expect(can("hotel_manager", "complaints.resolve")).toBe(true);
    expect(can("technician", "complaints.view")).toBe(false);
  });

  /* ── social media manager ─────────────────────────────────────────── */

  it("manages more than twenty channels, each with its own capability facts", async () => {
    expect(CHANNEL_CATALOGUE.length).toBeGreaterThan(20);
    const channels = await listChannels(propertyId);
    expect(channels.length).toBe(CHANNEL_CATALOGUE.length);
    // Every channel carries the facts that change how content is produced.
    for (const c of channels) {
      expect(c.maxChars).toBeGreaterThan(0);
      expect(["api", "draft", "reply"]).toContain(c.publish);
    }
    // Channel keys are unique — a duplicate would silently overwrite settings.
    expect(new Set(channels.map((c) => c.key)).size).toBe(channels.length);
    // Honest capability: TikTok has no usable publish API, so it says draft.
    expect(channels.find((c) => c.key === "tiktok")?.publish).toBe("draft");
    expect(channels.find((c) => c.key === "google_reviews")?.publish).toBe("reply");
  });

  it("each channel keeps its OWN settings — X's cadence is not Instagram's", async () => {
    await updateChannel({
      actor,
      channel: "instagram",
      patch: { enabled: true, handle: "@alta_riyadh", postsPerWeek: 5, bestTimes: ["19:00", "21:30"], tone: "بصري ودافئ" },
    });
    await updateChannel({
      actor,
      channel: "x",
      patch: { enabled: true, handle: "@alta_ksa", postsPerWeek: 12, bestTimes: ["08:00"], tone: "خبري مختصر" },
    });

    const channels = await listChannels(propertyId);
    const ig = channels.find((c) => c.key === "instagram")!;
    const x = channels.find((c) => c.key === "x")!;
    expect(ig.postsPerWeek).toBe(5);
    expect(x.postsPerWeek).toBe(12);
    expect(ig.bestTimes).toEqual(["19:00", "21:30"]);
    expect(x.bestTimes).toEqual(["08:00"]);
    expect(ig.tone).not.toBe(x.tone);
    // An untouched channel keeps the catalogue default, not another's value.
    expect(channels.find((c) => c.key === "linkedin")?.configured).toBe(false);
  });

  it("§7: auto-publish is off by default and must be turned on deliberately", async () => {
    const channels = await listChannels(propertyId);
    expect(channels.every((c) => c.autoPublish === false)).toBe(true);
  });

  it("generation respects each channel's own length limit", async () => {
    const x = await generateForChannel({ propertyId, channel: "x", count: 2 });
    expect(x.ok).toBe(true);
    if (x.ok) {
      // X caps at 280 — a draft that doesn't fit is FLAGGED, never silently cut.
      for (const d of x.drafts) {
        expect(typeof d.fits).toBe("boolean");
        if (d.fits) expect(d.body.length).toBeLessThanOrEqual(280);
      }
    }
    const unknown = await generateForChannel({ propertyId, channel: "myspace", count: 1 });
    expect(unknown.ok).toBe(false);
  });

  it("the calendar plans slots per channel and the analytics tab reports per channel", async () => {
    const cal = await channelCalendar(propertyId, 7);
    // Only ENABLED channels are planned — a channel nobody turned on is
    // not a gap to nag about.
    const keys = new Set(cal.plan.map((p) => p.channel));
    expect(keys.has("linkedin")).toBe(false);
    expect(keys).toEqual(new Set(["instagram", "x"]));
    // Target follows each channel's own cadence: X posts 12/wk, IG 5/wk.
    expect(cal.plan.find((p) => p.channel === "x")!.target).toBe(12);
    expect(cal.plan.find((p) => p.channel === "instagram")!.target).toBe(5);
    // Nothing scheduled yet, so every target is an open gap.
    expect(cal.totalGap).toBe(17);

    const analytics = await channelAnalytics(propertyId);
    // Only enabled channels are reported, and each row is a real channel.
    expect(analytics.perChannel.length).toBe(2); // instagram + x were enabled above
    expect(analytics.channelsAvailable).toBe(CHANNEL_CATALOGUE.length);
    expect(analytics.perChannel.every((c) => typeof c.channel === "string")).toBe(true);
  });

  /* ── complaint & reputation manager ───────────────────────────────── */

  it("triage: a threat to post publicly outranks polite wording", () => {
    const quiet = triageComplaint("الغرفة ما كانت مرتبة عند الوصول");
    const threat = triageComplaint("الغرفة وسخة وبكتب تقييم على قوقل عن الفندق");
    expect(threat.reputationRisk).toBeGreaterThan(quiet.reputationRisk);
    expect(threat.signals.join(" ")).toMatch(/تقييم علني/);
    expect(threat.category).toBe("cleanliness");
  });

  it("triage: safety and legal language are critical regardless of tone", () => {
    const safety = triageComplaint("باب الطوارئ في الدور الثالث مقفل");
    expect(safety.category).toBe("safety");
    expect(safety.severity).toBe("critical");

    const legal = triageComplaint("سأتواصل مع محامي بخصوص ما حدث");
    expect(legal.severity).toBe("critical");
  });

  it("captures a case and alerts when the reputation clock is running", async () => {
    const { kase, triage } = await captureComplaint({
      propertyId,
      text: `الخدمة سيئة جدا والموظف كان غير محترم وبكتب تقييم ${stamp}`,
      source: "whatsapp",
    });
    expect(kase.status).toBe("open");
    expect(kase.reputationRisk).toBeGreaterThanOrEqual(60);
    expect(triage.signals.length).toBeGreaterThan(0);
    // Five whys are pre-filled as QUESTIONS for the investigator.
    const whys = kase.rcaWhy as Array<{ question: string; answer: string }>;
    expect(whys.length).toBe(5);
    expect(whys.every((w) => w.question.length > 0 && w.answer === "")).toBe(true);
    // DB trigger derived tenancy like every other table.
    expect(kase.tenantId).toBe(`tnt-${propertyId}`);

    const alert = await prisma.altaEvent.findFirst({
      where: { propertyId, type: "complaint.reputation_risk" },
    });
    expect(alert).toBeTruthy();
  });

  it("action plan deadlines tighten with severity", () => {
    const normal = proposeActions("facilities", "medium");
    const critical = proposeActions("facilities", "critical");
    const firstNormal = new Date(normal[0].dueAt).getTime();
    const firstCritical = new Date(critical[0].dueAt).getTime();
    expect(firstCritical).toBeLessThan(firstNormal);
    expect(normal.every((a) => a.done === false)).toBe(true);
  });

  it("RCA drives the action plan; a case cannot be closed on optimism", async () => {
    const kase = await prisma.complaintCase.findFirstOrThrow({ where: { propertyId, status: "open" } });

    // Resolving before any analysis is refused — "resolved" must not just
    // mean "we stopped looking".
    const premature = await updateCase({ actor, caseId: kase.id, status: "resolved" });
    expect(premature.ok).toBe(false);
    if (!premature.ok) expect(premature.status).toBe(422);

    // RCA requires a stated root cause.
    const noCause = await recordRca({ actor, caseId: kase.id, answers: [], rootCause: "  " });
    expect(noCause.ok).toBe(false);

    const rca = await recordRca({
      actor,
      caseId: kase.id,
      answers: [{ question: "لماذا؟", answer: "نقص تدريب على التعامل مع الاعتراضات" }],
      rootCause: "غياب تدريب معتمد على سيناريو الاعتراض",
      contributing: ["ذروة وصول", "نقص موظف واحد في المناوبة"],
    });
    expect(rca.ok).toBe(true);
    if (rca.ok) expect(rca.actions.length).toBeGreaterThan(0);

    const planned = await prisma.complaintCase.findUniqueOrThrow({ where: { id: kase.id } });
    expect(planned.status).toBe("action_planned");
    expect(planned.rootCause).toContain("تدريب");

    // Still refused: a root cause with no completed action is a document,
    // not a fix.
    const stillOpen = await updateCase({ actor, caseId: kase.id, status: "resolved" });
    expect(stillOpen.ok).toBe(false);

    const actions = (planned.actions as Array<{ action: string; owner: string; dueAt: string; done: boolean }>).map(
      (a, i) => ({ ...a, done: i === 0 })
    );
    const closed = await updateCase({
      actor,
      caseId: kase.id,
      actions,
      status: "resolved",
      resolutionNote: "تم التدريب وأُبلغ النزيل",
    });
    expect(closed.ok).toBe(true);
    const done = await prisma.complaintCase.findUniqueOrThrow({ where: { id: kase.id } });
    expect(done.status).toBe("resolved");
    expect(done.resolvedAt).toBeTruthy();
  });

  it("patterns surface REPEAT root causes, not one-off noise", async () => {
    for (let i = 0; i < 2; i++) {
      const { kase } = await captureComplaint({ propertyId, text: `المكيف ما يبرد في الغرفة ${stamp}-${i}` });
      await recordRca({
        actor,
        caseId: kase.id,
        answers: [],
        rootCause: "لا توجد صيانة وقائية لمكيفات الدور الثالث",
      });
    }
    const patterns = await complaintPatterns(propertyId);
    expect(patterns.total).toBeGreaterThanOrEqual(3);
    // The cause seen twice is reported; the one seen once is not.
    const causes = patterns.repeatRootCauses.map((r) => r.cause);
    expect(causes.some((c) => c.includes("صيانة وقائية"))).toBe(true);
    expect(causes.some((c) => c.includes("تدريب معتمد"))).toBe(false);
    expect(patterns.byCategory.facilities).toBeGreaterThanOrEqual(2);
  });

  it("connect says the truth per channel: oauth, token, or honestly manual", async () => {
    const { startConnect } = await import("../src/modules/social/connect.js");
    // No developer app registered in tests, so an oauth channel falls back
    // to the credential path rather than opening a broken redirect.
    const ig = startConnect("instagram", propertyId);
    expect(ig?.mode).toBe("token");
    // Telegram never uses oauth — a bot token IS the auth.
    expect(startConnect("telegram", propertyId)?.mode).toBe("token");
    // Channels with no automated surface say so instead of pretending.
    const snap = startConnect("snapchat", propertyId);
    expect(snap?.mode).toBe("manual");
    if (snap?.mode === "manual") expect(snap.noteAr.length).toBeGreaterThan(10);
    expect(startConnect("nope", propertyId)).toBeNull();
  });

  it("an unconnected channel grants the agent NO execution capability", async () => {
    const { agentCapabilities } = await import("../src/modules/social/connections.js");
    const off = agentCapabilities("instagram", false);
    expect(off.canPublish).toBe(false);
    expect(off.canReadAnalytics).toBe(false);
    expect(off.canDraft).toBe(true); // drafting never needed a connection
    expect(off.blockedReasonAr).toContain("غير موصولة");

    // Connected AND publishable → the agent may act.
    const on = agentCapabilities("instagram", true);
    expect(on.canPublish).toBe(true);
    // Connected but the platform has no publish API → still cannot publish,
    // because claiming otherwise would report success for a post that
    // never existed.
    const tiktok = agentCapabilities("tiktok", true);
    expect(tiktok.canPublish).toBe(false);
    expect(tiktok.blockedReasonAr.length).toBeGreaterThan(10);
    // A reply surface grants reply, not publish.
    const gr = agentCapabilities("google_reviews", true);
    expect(gr.canReply).toBe(true);
    expect(gr.canPublish).toBe(false);
  });

  it("the oauth callback state cannot connect a channel to another hotel", async () => {
    const { verifyState } = await import("../src/modules/social/connect.js");
    expect(verifyState("not-a-real-state")).toBeNull();
    // A forged state with the right shape but no valid HMAC is rejected.
    const forged = Buffer.from(`other-hotel|instagram|${Date.now()}|abcd|deadbeef`).toString("base64url");
    expect(verifyState(forged)).toBeNull();
  });

  it("a rejected token is never stored as a working connection", async () => {
    const { saveChannelCredentials } = await import("../src/modules/social/connect.js");
    // Telegram verification calls the real API; a junk bot token is refused.
    const result = await saveChannelCredentials({
      actor,
      channel: "telegram",
      token: "000000:definitely-not-a-real-bot-token",
      account: "@nope",
    });
    expect(result.ok).toBe(false);
    const row = await prisma.socialChannel.findUnique({
      where: { propertyId_channel: { propertyId, channel: "telegram" } },
    });
    expect(row?.connected).toBe(false);
    expect(row?.connectionError.length).toBeGreaterThan(0);
  }, 20_000);

  it("a real Arabic complaint is DETECTED, so a case can exist at all", async () => {
    const { RuleBasedIntentEngine } = await import("../src/modules/nlu/ruleBasedEngine.js");
    const engine = new RuleBasedIntentEngine();
    // How a guest actually writes it — feminine/hamza variants that the
    // original pattern missed, which silently meant no case was ever opened.
    for (const text of [
      "الغرفة وسخة والخدمة سيئة وبكتب تقييم على قوقل",
      "الموظف كان غير محترم",
      "the room was dirty and the staff were rude",
    ]) {
      const env = await engine.extract(text);
      expect(env.intents.map((i) => i.type), text).toContain("guest_service.complaint");
    }
  });

  it("cases are tenant-scoped like everything else (§11-1)", async () => {
    const kase = await prisma.complaintCase.findFirstOrThrow({ where: { propertyId } });
    const foreign = await updateCase({
      actor: { staffId: "x", name: "x", propertyId: `agents-other-${stamp}` },
      caseId: kase.id,
      status: "investigating",
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.status).toBe(404);
  });
});
