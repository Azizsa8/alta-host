import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { publishDueContent } from "./service.js";

const QUEUE = process.env.INGEST_QUEUE_NAME
  ? `content-publish-${process.env.INGEST_QUEUE_NAME}` // env-isolated like ingest
  : "content-publish";

/** Every minute: publish scheduled content whose moment has come.
 *  publishDueContent is idempotent — published items leave the query. */
export function startContentScheduler(): Worker {
  const queue = new Queue(QUEUE, { connection: createRedisConnection() });
  queue
    .upsertJobScheduler("content-publish-1m", { every: 60 * 1000 }, { name: "tick" })
    .catch((err) => logger.warn({ err }, "content schedule failed"));

  const worker = new Worker(
    QUEUE,
    async () => {
      const published = await publishDueContent();
      if (published > 0) logger.info({ published }, "scheduled content published");
    },
    { connection: createRedisConnection() }
  );
  worker.on("failed", (_j, err) => logger.error({ err }, "content publish tick failed"));
  return worker;
}
