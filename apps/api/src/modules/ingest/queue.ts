import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { processInboundMessage } from "../orchestrator/index.js";
import { resolveConversation, sendWhatsAppMessage } from "../whatsapp/gateway.js";

export const INGEST_QUEUE = "inbound-messages";

/**
 * Deliberately carries only what the transport already knows. Resolving
 * the guest/conversation means database round-trips, and doing those in
 * the webhook handler serialises every concurrent request on the
 * connection pool — measured at p50 1.7s under 40-way concurrency. The
 * webhook's only job is to be fast enough that WhatsApp never retries.
 */
export interface InboundJob {
  propertyId: string;
  whatsappId: string;
  guestName?: string;
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
      // Conversation resolution happens here, off the webhook's critical
      // path, where its DB round-trips cost queue throughput instead of
      // transport-visible latency.
      const { guest, conversation } = await resolveConversation({
        propertyId: job.data.propertyId,
        whatsappId: job.data.whatsappId,
        guestName: job.data.guestName,
      });
      const result = await processInboundMessage({
        propertyId: job.data.propertyId,
        guestId: guest.id,
        conversationId: conversation.id,
        text: job.data.text,
        mediaType: job.data.mediaType,
      });
      // Same policy as the old inline path: only immediately-dispatched
      // outcomes go out over WhatsApp — anything queued_for_review waits
      // for a staff decision (FR-6).
      for (const outcome of result.outcomes) {
        if (outcome.status === "sent" && outcome.reply) {
          await sendWhatsAppMessage(conversation.id, outcome.reply);
        }
      }
    },
    {
      connection: createRedisConnection(),
      // Measured on this stack with scripts/load-test.mts (200 messages,
      // 40-way client concurrency). End-to-end throughput / drain time:
      //    5 →  8.0 msg/s, 25.1s
      //   20 → 28.5 msg/s,  7.0s   ← knee
      //   50 → 24.9 msg/s,  8.0s
      // Past ~20 the workers contend with the webhook handler for the same
      // Postgres pool: throughput falls AND ack latency degrades (p50
      // 49ms → 198ms). Re-measure before raising this on different hardware.
      concurrency: Number(process.env.INGEST_CONCURRENCY ?? 20),
    }
  );
  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "inbound job failed"));
  return worker;
}
