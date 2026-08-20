import { describe, it, expect, afterAll } from "vitest";
import { Queue } from "bullmq";
import { createRedisConnection } from "../src/redis.js";
import { enqueueInbound, INGEST_QUEUE } from "../src/modules/ingest/queue.js";

describe("ingest queue", () => {
  const connection = createRedisConnection();
  const queue = new Queue(INGEST_QUEUE, { connection });

  afterAll(async () => {
    await queue.close();
    connection.disconnect();
  });

  it("deduplicates by transport message id", async () => {
    const dedupeKey = `dup-${Date.now()}`;
    const job = { propertyId: "p", guestId: "g", conversationId: "c", text: "hi", dedupeKey };
    await enqueueInbound(job);
    await enqueueInbound(job); // same transport id — must not create a second job
    const matches = (await queue.getJobs(["waiting", "active", "completed", "delayed"])).filter(
      (x) => x.id === dedupeKey
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].data.text).toBe("hi");
  });
});
