import { once } from "node:events";
import { prisma } from "../../db.js";
import { getRedis } from "../../redis.js";
import { logger } from "../../logger.js";
import { EVENTS_CHANNEL, type AltaEventBody, type PublishedEvent } from "./types.js";

/**
 * Persist-first, publish-best-effort: the Postgres row is the source of
 * truth (SSE replay reads it); the Redis publish only accelerates delivery
 * to currently-connected dashboards. A dead Redis must never fail the
 * business operation that emitted the event.
 */
export async function emitEvent(propertyId: string, body: AltaEventBody): Promise<void> {
  const row = await prisma.altaEvent.create({
    data: { propertyId, type: body.type, payload: JSON.stringify(body) },
  });
  const published: PublishedEvent = {
    seq: row.seq.toString(),
    propertyId,
    type: body.type,
    payload: body,
    createdAt: row.createdAt.toISOString(),
  };
  // Deliberately not awaited. The row above is the source of truth and is
  // already committed; this publish only accelerates delivery to connected
  // dashboards. Awaiting it put a Redis round-trip on the pipeline's
  // critical path for every one of the 5+ events a single message emits.
  // A publish still in flight when the process exits costs nothing — a
  // reconnecting client replays from Postgres via Last-Event-ID.
  publishWhenReady(JSON.stringify(published)).catch((err) =>
    logger.warn({ err, type: body.type }, "event publish failed (persisted; live feed will catch up on reconnect)")
  );
}

/** How long a publish may wait for the connection to come up. */
const READY_WAIT_MS = 2_000;

/**
 * Publishes once the shared connection is ready, waiting a BOUNDED moment
 * if it is still connecting.
 *
 * The shared connection runs with the offline queue off, so a publish
 * against a dead Redis fails fast instead of queueing forever — the right
 * call. But the same setting also rejected the very first publish after
 * every process start, because the connection is still handshaking when
 * the first event arrives. That event was persisted yet never reached a
 * live screen: after each deploy, the first thing to happen — typically a
 * guest's WhatsApp — silently skipped the Ops Center.
 *
 * Waiting for "ready", capped at READY_WAIT_MS, keeps both properties: a
 * connecting Redis gets a moment, a dead one still fails fast. This runs
 * off the pipeline's critical path (emitEvent does not await it), so the
 * wait never slows message handling.
 */
async function publishWhenReady(payload: string): Promise<void> {
  const redis = getRedis();
  if (redis.status !== "ready") {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), READY_WAIT_MS);
    try {
      await once(redis, "ready", { signal: abort.signal });
    } catch {
      throw new Error(`redis not ready within ${READY_WAIT_MS}ms (status: ${redis.status})`);
    } finally {
      clearTimeout(timer);
    }
  }
  await redis.publish(EVENTS_CHANNEL, payload);
}
