import { Router } from "express";
import { prisma } from "../../db.js";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { requireAuth } from "../auth/middleware.js";
import { EVENTS_CHANNEL, type PublishedEvent } from "./types.js";

export const sseRouter = Router();

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
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const send = (evt: PublishedEvent) => {
    res.write(`id: ${evt.seq}\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  // Replay anything missed since the client's last cursor, then go live.
  const lastId = req.headers["last-event-id"];
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

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    listeners.delete(listener);
  });
});
