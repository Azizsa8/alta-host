import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { processInboundMessage } from "../orchestrator/index.js";
import { sendWhatsAppMessage } from "../whatsapp/gateway.js";

export const INGEST_QUEUE = "inbound-messages";

export interface InboundJob {
  propertyId: string;
  guestId: string;
  conversationId: string;
  text: string;
  mediaType?: "text" | "voice";
  dedupeKey: string;
}

let queue: Queue<InboundJob> | undefined;
function getQueue(): Queue<InboundJob> {
  queue ??= new Queue<InboundJob>(INGEST_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 24 * 3600, count: 5000 },
      removeOnFail: false, // failed jobs stay visible — they're the DLQ
    },
  });
  return queue;
}

/** Enqueue an inbound guest message; duplicate transport ids are dropped
 *  (WhatsApp redelivers webhooks — jobId is the idempotency key). */
export async function enqueueInbound(job: InboundJob): Promise<void> {
  await getQueue().add("inbound", job, { jobId: job.dedupeKey });
}

export function startIngestWorker(): Worker<InboundJob> {
  const worker = new Worker<InboundJob>(
    INGEST_QUEUE,
    async (job) => {
      const result = await processInboundMessage(job.data);
      // Same policy as the old inline path: only immediately-dispatched
      // outcomes go out over WhatsApp — anything queued_for_review waits
      // for a staff decision (FR-6).
      for (const outcome of result.outcomes) {
        if (outcome.status === "sent" && outcome.reply) {
          await sendWhatsAppMessage(job.data.conversationId, outcome.reply);
        }
      }
    },
    { connection: createRedisConnection(), concurrency: 5 }
  );
  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "inbound job failed"));
  return worker;
}
