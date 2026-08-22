import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { prisma } from "../../db.js";
import { syncReviews } from "./service.js";

const POLL_QUEUE = process.env.INGEST_QUEUE_NAME
  ? `review-poll-${process.env.INGEST_QUEUE_NAME}` // env-isolated like ingest
  : "review-poll";

/** Every 30 minutes: pull new reviews for every linked Google account.
 *  syncReviews is idempotent per review, so overlap is harmless. */
export function startReviewPoll(): Worker {
  const queue = new Queue(POLL_QUEUE, { connection: createRedisConnection() });
  queue
    .upsertJobScheduler("review-poll-30m", { every: 30 * 60 * 1000 }, { name: "poll" })
    .catch((err) => logger.warn({ err }, "review poll schedule failed"));

  const worker = new Worker(
    POLL_QUEUE,
    async () => {
      const accounts = await prisma.socialAccount.findMany({
        where: { platform: "google", status: "linked" },
      });
      for (const account of accounts) {
        const result = await syncReviews(account.propertyId);
        if (result.new > 0) logger.info({ propertyId: account.propertyId, ...result }, "review sync");
      }
    },
    { connection: createRedisConnection() }
  );
  worker.on("failed", (_j, err) => logger.error({ err }, "review poll failed"));
  return worker;
}
