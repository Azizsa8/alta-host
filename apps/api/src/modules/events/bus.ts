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
  getRedis()
    .publish(EVENTS_CHANNEL, JSON.stringify(published))
    .catch((err) =>
      logger.warn({ err, type: body.type }, "event publish failed (persisted; live feed will catch up on reconnect)")
    );
}
