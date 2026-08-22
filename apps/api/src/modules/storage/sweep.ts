import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { sweepStorage } from "./service.js";

const SWEEP_QUEUE = process.env.INGEST_QUEUE_NAME
  ? `storage-sweep-${process.env.INGEST_QUEUE_NAME}` // env-isolated like ingest
  : "storage-sweep";

/** Hourly: hard-delete 30-day trash (§5) and release abandoned upload
 *  reservations so quota can't leak upward forever. */
export function startStorageSweep(): Worker {
  const queue = new Queue(SWEEP_QUEUE, { connection: createRedisConnection() });
  // BullMQ v6: repeatable jobs are job schedulers.
  queue
    .upsertJobScheduler("storage-sweep-hourly", { every: 60 * 60 * 1000 }, { name: "sweep" })
    .catch((err) => logger.warn({ err }, "sweep schedule failed"));

  const worker = new Worker(
    SWEEP_QUEUE,
    async () => {
      const result = await sweepStorage();
      if (result.purged || result.released) logger.info(result, "storage sweep");
    },
    { connection: createRedisConnection() }
  );
  worker.on("failed", (_j, err) => logger.error({ err }, "storage sweep failed"));
  return worker;
}
