import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import { emitEvent } from "../events/bus.js";
import { CHANNEL_CATALOGUE, channelSpec, type ChannelSpec } from "./catalogue.js";
import { draftFromIdea, generateIdeas } from "../content/service.js";

/** Catalogue + this hotel's per-channel settings and analytics, merged. */
export async function listChannels(propertyId: string) {
  const rows = await prisma.socialChannel.findMany({ where: { propertyId } });
  const bySpec = new Map(rows.map((r) => [r.channel, r]));
  return CHANNEL_CATALOGUE.map((spec) => {
    const row = bySpec.get(spec.key);
    return {
      ...spec,
      configured: !!row,
      enabled: row?.enabled ?? false,
      autoPublish: row?.autoPublish ?? false,
      handle: row?.handle ?? "",
      postsPerWeek: row?.postsPerWeek ?? spec.defaultPostsPerWeek,
      bestTimes: (row?.bestTimes as string[] | undefined) ?? [],
      tone: row?.tone || spec.toneHintAr,
      hashtags: (row?.hashtags as string[] | undefined) ?? [],
      audienceNote: row?.audienceNote ?? "",
      followers: row?.followers ?? 0,
      reach30d: row?.reach30d ?? 0,
      engagement30d: row?.engagement30d ?? 0,
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
    };
  });
}

export async function updateChannel(params: {
  actor: { staffId: string; name: string; propertyId: string };
  channel: string;
  patch: {
    enabled?: boolean;
    autoPublish?: boolean;
    handle?: string;
    postsPerWeek?: number;
    bestTimes?: string[];
    tone?: string;
    hashtags?: string[];
    audienceNote?: string;
  };
}): Promise<{ ok: true; channel: unknown } | { ok: false; status: number; error: string }> {
  const spec = channelSpec(params.channel);
  if (!spec) return { ok: false, status: 404, error: "unknown channel" };

  // §7: a channel we can only DRAFT to must never claim auto-publish — the
  // setting would silently do nothing and the hotel would think it posted.
  if (params.patch.autoPublish && spec.publish !== "api") {
    return {
      ok: false,
      status: 422,
      error: `${spec.name} has no publishing API — content is prepared for a human to post`,
    };
  }

  const row = await prisma.socialChannel.upsert({
    where: { propertyId_channel: { propertyId: params.actor.propertyId, channel: params.channel } },
    create: {
      propertyId: params.actor.propertyId,
      channel: params.channel,
      postsPerWeek: spec.defaultPostsPerWeek,
      tone: spec.toneHintAr,
      ...params.patch,
    },
    update: params.patch,
  });

  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "social.channel_update",
    resourceType: "SocialChannel",
    resourceId: params.channel,
    outcome: "success",
    metadata: { ...params.patch },
  });
  return { ok: true, channel: row };
}

/**
 * The channel's own content station: ideas from the brand profile, rewritten
 * against THIS channel's limits and voice. A caption that fits Facebook is
 * not a caption that fits X, so the length ceiling is applied per channel
 * rather than trusting the writer to remember 22 different limits.
 */
export async function generateForChannel(params: {
  propertyId: string;
  channel: string;
  count?: number;
}): Promise<{ ok: true; drafts: Array<{ idea: string; body: string; fits: boolean }> } | { ok: false; status: number; error: string }> {
  const spec = channelSpec(params.channel);
  if (!spec) return { ok: false, status: 404, error: "unknown channel" };

  const row = await prisma.socialChannel.findUnique({
    where: { propertyId_channel: { propertyId: params.propertyId, channel: params.channel } },
  });
  const tone = row?.tone || spec.toneHintAr;
  const tags = ((row?.hashtags as string[] | undefined) ?? []).slice(0, 4);

  const ideas = (await generateIdeas(params.propertyId)).slice(0, params.count ?? 3);
  const drafts = [];
  for (const idea of ideas) {
    const base = await draftFromIdea(params.propertyId, idea);
    let body = shapeForChannel(base.bodyAr, spec, tone, tags);
    drafts.push({ idea, body, fits: body.length <= spec.maxChars });
  }
  return { ok: true, drafts };
}

/** Channel-shaped copy: hard limit respected, hashtags only where they earn
 *  their place, and no hashtag soup on channels that punish it. */
function shapeForChannel(bodyAr: string, spec: ChannelSpec, tone: string, tags: string[]): string {
  let body = bodyAr.trim();
  const wantsTags = ["instagram", "instagram_reels", "tiktok", "threads", "x", "pinterest"].includes(spec.key);
  const tail = wantsTags && tags.length > 0 ? "\n\n" + tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ") : "";

  // Short-form channels get the first punchy line, not a truncated essay.
  if (spec.maxChars <= 300) {
    const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? body;
    body = firstLine.trim();
  }
  const budget = spec.maxChars - tail.length;
  if (body.length > budget) body = body.slice(0, Math.max(0, budget - 1)).trimEnd() + "…";
  return body + tail;
}

/**
 * The posting calendar for a window: what is already scheduled, plus the
 * gap between that and each enabled channel's target cadence. The gap is
 * the useful part — "you planned 2 of 4 Instagram posts this week" is
 * actionable in a way a list of scheduled posts is not.
 */
export async function channelCalendar(propertyId: string, days = 14) {
  const from = new Date();
  const to = new Date(Date.now() + days * 24 * 3600 * 1000);

  const scheduled = await prisma.contentItem.findMany({
    where: { propertyId, scheduledAt: { gte: from, lte: to } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, channel: true, idea: true, status: true, scheduledAt: true },
  });

  const channels = await prisma.socialChannel.findMany({ where: { propertyId, enabled: true } });
  const weeks = days / 7;
  const plan = channels.map((c) => {
    const spec = channelSpec(c.channel);
    const planned = scheduled.filter((s) => s.channel === c.channel).length;
    const target = Math.round(c.postsPerWeek * weeks);
    return {
      channel: c.channel,
      nameAr: spec?.nameAr ?? c.channel,
      target,
      planned,
      gap: Math.max(0, target - planned),
      bestTimes: (c.bestTimes as string[] | undefined) ?? [],
    };
  });

  return {
    windowDays: days,
    scheduled: scheduled.map((s) => ({ ...s, scheduledAt: s.scheduledAt?.toISOString() ?? null })),
    plan,
    totalGap: plan.reduce((a, p) => a + p.gap, 0),
  };
}

/**
 * Per-channel analytics. Published counts come from real ContentItem rows;
 * reach/engagement/followers come from whatever the platform reported at the
 * last sync and are shown with that timestamp — never invented, and clearly
 * zero-with-a-null-date when a channel has never been synced.
 */
export async function channelAnalytics(propertyId: string) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await prisma.socialChannel.findMany({ where: { propertyId } });

  const published = await prisma.contentItem.groupBy({
    by: ["channel"],
    where: { propertyId, status: "published", publishedAt: { gte: since } },
    _count: true,
  });
  const failed = await prisma.contentItem.groupBy({
    by: ["channel"],
    where: { propertyId, status: "failed", updatedAt: { gte: since } },
    _count: true,
  });
  const pub = (k: string) => published.find((p) => p.channel === k)?._count ?? 0;
  const fail = (k: string) => failed.find((p) => p.channel === k)?._count ?? 0;

  const perChannel = rows
    .filter((r) => r.enabled)
    .map((r) => {
      const spec = channelSpec(r.channel);
      return {
        channel: r.channel,
        nameAr: spec?.nameAr ?? r.channel,
        publish: spec?.publish ?? "draft",
        published30d: pub(r.channel),
        failed30d: fail(r.channel),
        followers: r.followers,
        reach30d: r.reach30d,
        engagement30d: r.engagement30d,
        engagementRate: r.reach30d > 0 ? Math.round((r.engagement30d / r.reach30d) * 1000) / 10 : null,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      };
    });

  return {
    windowDays: 30,
    channelsEnabled: perChannel.length,
    channelsAvailable: CHANNEL_CATALOGUE.length,
    totalPublished30d: perChannel.reduce((a, c) => a + c.published30d, 0),
    perChannel,
  };
}

/** Records platform-reported figures for a channel. Kept explicit (rather
 *  than inferred) so a number on screen always has a source and a date. */
export async function recordChannelStats(params: {
  propertyId: string;
  channel: string;
  followers?: number;
  reach30d?: number;
  engagement30d?: number;
}) {
  if (!channelSpec(params.channel)) return null;
  const row = await prisma.socialChannel.upsert({
    where: { propertyId_channel: { propertyId: params.propertyId, channel: params.channel } },
    create: {
      propertyId: params.propertyId,
      channel: params.channel,
      followers: params.followers ?? 0,
      reach30d: params.reach30d ?? 0,
      engagement30d: params.engagement30d ?? 0,
      lastSyncedAt: new Date(),
    },
    update: {
      ...(params.followers !== undefined ? { followers: params.followers } : {}),
      ...(params.reach30d !== undefined ? { reach30d: params.reach30d } : {}),
      ...(params.engagement30d !== undefined ? { engagement30d: params.engagement30d } : {}),
      lastSyncedAt: new Date(),
    },
  });
  await emitEvent(params.propertyId, {
    type: "social.stats",
    channel: params.channel,
    followers: row.followers,
    reach30d: row.reach30d,
  });
  return row;
}
