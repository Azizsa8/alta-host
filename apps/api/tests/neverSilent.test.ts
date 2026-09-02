import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { processInboundMessage } from "../src/modules/orchestrator/index.js";
import { enqueueInbound, startIngestWorker } from "../src/modules/ingest/queue.js";
import { Queue } from "bullmq";
import { createRedisConnection } from "../src/redis.js";

/**
 * A guest must never be met with silence. §7 holds the substantive ANSWER
 * for a human, but the guest still gets an acknowledgement in their own
 * language — and an unclassifiable message gets a real reply too.
 */
describe("no guest message goes unanswered", () => {
  const stamp = Date.now();
  const propertyId = `silent-${stamp}`;
  const whatsappId = `9665sil${stamp}`;
  let guestId = "";
  let conversationId = "";

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "Silence Hotel" } });
    const guest = await prisma.guest.create({
      data: { propertyId, whatsappId, name: "نزيل صامت", preferredDialect: "saudi" },
    });
    guestId = guest.id;
    conversationId = (await prisma.conversation.create({ data: { guestId } })).id;

    // Failed jobs left by PREVIOUS runs get retried by our worker and drown
    // the assertions in unrelated noise. Clean only those: obliterate()
    // would also delete the in-flight jobs of suites running in parallel
    // on this shared queue, which is exactly how this test once broke the
    // takeover and ingest suites.
    const q = new Queue(process.env.INGEST_QUEUE_NAME ?? "inbound-messages", {
      connection: createRedisConnection(),
    });
    await q.clean(0, 5000, "failed");
    await q.close();
  });

  it("an unclassifiable message gets an Arabic reply, not English boilerplate", async () => {
    const result = await processInboundMessage({
      propertyId,
      guestId,
      conversationId,
      text: `مرحبا ${stamp}`,
    });
    const outcome = result.outcomes[0];
    expect(outcome.status).toBe("sent");
    expect(outcome.reply).toBeTruthy();
    // Arabic script, and specifically NOT the old English boilerplate.
    expect(outcome.reply).toMatch(/[؀-ۿ]/);
    expect(outcome.reply).not.toContain("Got it");
  });

  it("an English-writing guest gets English back", async () => {
    const enGuest = await prisma.guest.create({
      data: { propertyId, whatsappId: `44770${stamp}`, name: "James", preferredDialect: "english" },
    });
    const conv = await prisma.conversation.create({ data: { guestId: enGuest.id } });
    const result = await processInboundMessage({
      propertyId,
      guestId: enGuest.id,
      conversationId: conv.id,
      text: `hello there ${stamp}`,
    });
    expect(result.outcomes[0].reply).toMatch(/team member/i);
  });

  it("a review-held question still gets an acknowledgement over WhatsApp", async () => {
    const worker = startIngestWorker();
    try {
      await enqueueInbound({
        propertyId,
        whatsappId,
        text: `متى الفطور عندكم؟ ${stamp}`,
        dedupeKey: `ack-${stamp}`,
      });

      // Wait for the outbound acknowledgement to land.
      let outbound: { rawText: string } | null = null;
      for (let i = 0; i < 40 && !outbound; i++) {
        await new Promise((r) => setTimeout(r, 250));
        outbound = await prisma.message.findFirst({
          where: { conversationId, direction: "outbound" },
          orderBy: { createdAt: "desc" },
          select: { rawText: true },
        });
      }
      expect(outbound, "guest received no reply at all").toBeTruthy();
      expect(outbound!.rawText).toMatch(/[؀-ۿ]/);

      // The substantive answer is still gated — the ack is not an answer.
      const review = await prisma.reviewItem.findFirst({
        where: { intent: { message: { conversationId } }, status: "pending" },
      });
      expect(review, "the real answer must still await human approval").toBeTruthy();
    } finally {
      await worker.close();
    }
  }, 30_000);

  it("exactly one acknowledgement per message, never one per intent", async () => {
    const before = await prisma.message.count({ where: { conversationId, direction: "outbound" } });
    const worker = startIngestWorker();
    try {
      await enqueueInbound({
        propertyId,
        whatsappId,
        // two review-queued intents in one message
        text: `ابي تمديد الاقامة وعندي شكوى على الخدمة ${stamp}`,
        dedupeKey: `ack2-${stamp}`,
      });
      await new Promise((r) => setTimeout(r, 6000));
      const after = await prisma.message.count({ where: { conversationId, direction: "outbound" } });
      expect(after - before).toBeLessThanOrEqual(1);
    } finally {
      await worker.close();
    }
  }, 30_000);
});
