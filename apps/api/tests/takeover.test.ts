import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Worker } from "bullmq";
import { prisma } from "../src/db.js";
import { enqueueInbound, startIngestWorker } from "../src/modules/ingest/queue.js";

/**
 * §11-3 acceptance: "AI replies stop the moment a staff member takes the
 * conversation over." Runs the real queue and the real worker — not a
 * mock of either — because the gate lives in the worker and a mocked
 * worker would test nothing.
 */
describe("manual AI takeover (§11-3)", () => {
  const stamp = Date.now();
  const propertyId = `takeover-${stamp}`;
  const phone = `9665to${stamp}`;
  let worker: Worker;
  let conversationId = "";

  async function sendAndDrain(text: string): Promise<void> {
    await enqueueInbound({
      propertyId,
      whatsappId: phone,
      text,
      dedupeKey: `to-${stamp}-${Math.random()}`,
    });
    // Drain: wait until the inbound message row exists (worker done with it).
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const found = await prisma.message.findFirst({
        where: { rawText: text, direction: "inbound" },
      });
      if (found) {
        // Give the send/skip step a beat to complete after the insert.
        await new Promise((r) => setTimeout(r, 400));
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`message "${text}" never processed`);
  }

  async function counts() {
    const conv = await prisma.conversation.findFirstOrThrow({
      where: { guest: { propertyId } },
    });
    conversationId = conv.id;
    const [outbound, intents] = await Promise.all([
      prisma.message.count({ where: { conversationId: conv.id, direction: "outbound" } }),
      prisma.intent.count({ where: { message: { conversationId: conv.id } } }),
    ]);
    return { outbound, intents, aiPaused: conv.aiPaused };
  }

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "Takeover Hotel" } });
    worker = startIngestWorker();
  });

  afterAll(async () => {
    await worker.close();
  });

  it("AI processes and replies while not taken over", async () => {
    await sendAndDrain(`نظفوا الغرفة لو سمحتوا ${stamp}`);
    const c = await counts();
    expect(c.intents).toBeGreaterThan(0);
    expect(c.outbound).toBeGreaterThan(0); // housekeeping confirms immediately
  });

  it("after takeover, the AI is silent: message recorded, nothing classified, nothing sent", async () => {
    const before = await counts();
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiPaused: true, takenOverBy: "Fahad", takenOverAt: new Date() },
    });

    await sendAndDrain(`وينكم؟ ما أحد رد علي ${stamp}`);
    const after = await counts();

    // The guest's message is visible to staff…
    const recorded = await prisma.message.findFirst({
      where: { conversationId, rawText: `وينكم؟ ما أحد رد علي ${stamp}` },
    });
    expect(recorded).toBeTruthy();
    // …but the AI did nothing with it.
    expect(after.intents).toBe(before.intents);
    expect(after.outbound).toBe(before.outbound);
  });

  it("after a manager resumes AI, processing continues", async () => {
    const before = await counts();
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiPaused: false, takenOverBy: null, takenOverAt: null },
    });

    await sendAndDrain(`المكيف خربان ${stamp}`);
    const after = await counts();
    expect(after.intents).toBeGreaterThan(before.intents);
    expect(after.outbound).toBeGreaterThan(before.outbound);
  });
});
