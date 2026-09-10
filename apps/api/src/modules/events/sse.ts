import { Router } from "express";
import { prisma } from "../../db.js";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { requireAuth } from "../auth/middleware.js";
import { EVENTS_CHANNEL, type PublishedEvent } from "./types.js";

export const sseRouter = Router();

/** 15s by default; overridable so a test can watch beats without waiting. */
function heartbeatMs(): number {
  const v = Number(process.env.SSE_HEARTBEAT_MS);
  return Number.isFinite(v) && v > 0 ? v : 15_000;
}

// One process-wide subscriber fanning out to N connected dashboards —
// never one Redis connection per HTTP client.
type Listener = (evt: PublishedEvent) => void;
const listeners = new Set<Listener>();
let subscriberStarted = false;

function ensureSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  const sub = createRedisConnection();
  sub.subscribe(EVENTS_CHANNEL).catch((err) => logger.error({ err }, "SSE subscribe failed"));
  sub.on("message", (_channel, raw) => {
    try {
      const evt = JSON.parse(raw) as PublishedEvent;
      for (const l of listeners) l(evt);
    } catch (err) {
      logger.warn({ err }, "bad event on channel");
    }
  });
}

function rowToPublished(row: {
  seq: bigint;
  propertyId: string;
  type: string;
  payload: string;
  createdAt: Date;
}): PublishedEvent {
  return {
    seq: row.seq.toString(),
    propertyId: row.propertyId,
    type: row.type as PublishedEvent["type"],
    payload: JSON.parse(row.payload),
    createdAt: row.createdAt.toISOString(),
  };
}

sseRouter.get("/events/stream", requireAuth, async (req, res) => {
  ensureSubscriber();
  const propertyId = req.staff!.propertyId;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    // no-transform also stops the web tier's gzip from buffering the stream.
    "Cache-Control": "no-cache, no-transform",
    // No Connection header: it is hop-by-hop and forbidden in HTTP/2, which
    // is what the browser speaks to the hosting edge.
    "X-Accel-Buffering": "no",
  });
  // retry: how long the browser waits before its own reconnect attempt.
  res.write("retry: 3000\n: connected\n\n");

  const send = (evt: PublishedEvent) => {
    res.write(`id: ${evt.seq}\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  // Replay anything missed since the client's last cursor, then go live.
  // The browser's own reconnect sends Last-Event-ID; a client that rebuilds
  // its EventSource after the browser gives up cannot set headers, so the
  // same cursor is also accepted as a query parameter.
  const lastId = req.headers["last-event-id"] ?? req.query.lastEventId;
  if (typeof lastId === "string" && /^\d+$/.test(lastId)) {
    const missed = await prisma.altaEvent.findMany({
      where: { propertyId, seq: { gt: BigInt(lastId) } },
      orderBy: { seq: "asc" },
      take: 500,
    });
    for (const row of missed) send(rowToPublished(row));
  }

  const listener: Listener = (evt) => {
    if (evt.propertyId === propertyId) send(evt);
  };
  listeners.add(listener);

  // A named event rather than an SSE comment: the browser never surfaces
  // comments to page code, so a comment heartbeat keeps the socket warm but
  // tells the client nothing. As an event it feeds the dashboard's
  // watchdog, which is what notices a connection that died silently.
  // 15s sits well inside every proxy idle timeout we deploy behind.
  const heartbeat = setInterval(() => res.write("event: ping\ndata: {}\n\n"), heartbeatMs());
  req.on("close", () => {
    clearInterval(heartbeat);
    listeners.delete(listener);
  });
});
