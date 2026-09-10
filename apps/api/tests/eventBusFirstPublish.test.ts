import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Redis } from "ioredis";
import { prisma } from "../src/db.js";
import { createRedisConnection } from "../src/redis.js";
import { emitEvent } from "../src/modules/events/bus.js";
import { EVENTS_CHANNEL, type PublishedEvent } from "../src/modules/events/types.js";

/**
 * Its own file on purpose: vitest isolates module state per file, so the
 * emitEvent below is the FIRST publish on a brand-new shared connection —
 * the exact moment after a deploy or restart that used to lose the event.
 *
 * The shared connection runs without an offline queue, so a publish issued
 * while it was still handshaking was rejected outright. The event was
 * persisted but never reached a live screen.
 */
describe("event bus — the first event after a process start", () => {
  const propertyId = `bus-first-${Date.now()}`;
  let sub: Redis;
  const received: PublishedEvent[] = [];

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "First Publish Hotel" } });
    sub = createRedisConnection();
    await sub.subscribe(EVENTS_CHANNEL);
    sub.on("message", (_ch, raw) => {
      const evt = JSON.parse(raw) as PublishedEvent;
      if (evt.propertyId === propertyId) received.push(evt);
    });
  });

  afterAll(async () => {
    await sub.quit();
  });

  it("reaches live subscribers instead of being dropped", async () => {
    await emitEvent(propertyId, { type: "social.connected", channel: "linkedin" });

    for (let i = 0; i < 30 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(received, "the first published event never reached a subscriber").toHaveLength(1);
    expect(received[0].type).toBe("social.connected");

    // and it is still persisted — the source of truth for replay
    const row = await prisma.altaEvent.findFirst({ where: { propertyId } });
    expect(row?.seq.toString()).toBe(received[0].seq);
  });
});
