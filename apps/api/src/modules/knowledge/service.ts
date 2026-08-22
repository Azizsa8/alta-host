import { prisma } from "../../db.js";

/**
 * §6-أ: "إذا كانت الإجابة في المعرفة المعتمدة" — the one query that feeds
 * agents filters to approved items, so drafts and retired items are
 * invisible to the pipeline by construction, not by discipline.
 *
 * Matching is deliberately simple and inspectable: a question matches an
 * item when any tag or title word appears in it. No embeddings yet — a
 * wrong FAQ answer to a hotel guest is worse than "a person will follow
 * up", so precision beats recall here.
 */
export async function findApprovedAnswer(
  propertyId: string,
  question: string
): Promise<{ id: string; title: string; contentAr: string; contentEn: string } | null> {
  const items = await prisma.knowledgeItem.findMany({
    where: { propertyId, status: "approved" },
    take: 200,
  });
  const q = question.toLowerCase();

  let best: { item: (typeof items)[number]; score: number } | null = null;
  for (const item of items) {
    const tags = Array.isArray(item.tags) ? (item.tags as string[]) : [];
    const needles = [...tags, ...item.title.split(/\s+/)].filter((t) => t.length >= 3);
    const score = needles.reduce((acc, needle) => (q.includes(needle.toLowerCase()) ? acc + 1 : acc), 0);
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  if (!best) return null;
  const { id, title, contentAr, contentEn } = best.item;
  return { id, title, contentAr, contentEn };
}

/** The agent centre's on/off switch. No row = enabled — the pipeline must
 *  keep working for hotels that never opened the agent centre.
 *
 *  Cached 10s: the read sits on the hot path of every dispatched intent,
 *  and a per-message DB roundtrip measurably cut ingest throughput.
 *  setAgentEnabled busts the cache, so in-process toggles bite instantly;
 *  a toggle from ANOTHER api instance bites within 10s — acceptable for
 *  §4's "يتوقف" and stated here so nobody discovers it in an incident. */
const policyCache = new Map<string, { enabled: boolean; at: number }>();

export async function isAgentEnabled(propertyId: string, agentKey: string): Promise<boolean> {
  const cacheKey = `${propertyId}:${agentKey}`;
  const hit = policyCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 10_000) return hit.enabled;
  const policy = await prisma.agentPolicy.findUnique({
    where: { propertyId_agentKey: { propertyId, agentKey } },
  });
  const enabled = policy?.enabled ?? true;
  policyCache.set(cacheKey, { enabled, at: Date.now() });
  return enabled;
}

export async function setAgentEnabled(params: {
  propertyId: string;
  agentKey: string;
  enabled: boolean;
  updatedBy: string;
}) {
  policyCache.delete(`${params.propertyId}:${params.agentKey}`);
  return prisma.agentPolicy.upsert({
    where: { propertyId_agentKey: { propertyId: params.propertyId, agentKey: params.agentKey } },
    create: {
      propertyId: params.propertyId,
      agentKey: params.agentKey,
      enabled: params.enabled,
      updatedBy: params.updatedBy,
    },
    update: { enabled: params.enabled, updatedBy: params.updatedBy },
  });
}

/** §9 run capture: every agent invocation, with what policy applied. */
export async function recordAgentRun(params: {
  propertyId: string;
  agentKey: string;
  intentId?: string;
  intentType: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  tools?: string[];
  policyApplied: "enabled" | "disabled_skipped" | "auto_approved" | "queued_for_review";
  durationMs: number;
}): Promise<void> {
  try {
    await prisma.agentRun.create({
      data: {
        propertyId: params.propertyId,
        agentKey: params.agentKey,
        intentId: params.intentId,
        intentType: params.intentType,
        inputs: (params.inputs ?? {}) as object,
        outputs: (params.outputs ?? {}) as object,
        tools: params.tools ?? [],
        policyApplied: params.policyApplied,
        durationMs: params.durationMs,
      },
    });
  } catch (err) {
    // Run capture must never break the guest-facing pipeline.
    console.error("agent run capture failed", err);
  }
}
