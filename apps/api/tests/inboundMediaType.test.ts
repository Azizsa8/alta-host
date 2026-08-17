import { describe, it, expect } from "vitest";
import { prisma } from "../src/db.js";
import { handleInbound } from "../src/modules/whatsapp/webhook.js";

describe("handleInbound — mediaType threading", () => {
  it("persists mediaType 'voice' on the Message row when a transcribed voice message comes in", async () => {
    const property = await prisma.property.create({ data: { name: "Voice Test Hotel" } });

    await handleInbound({
      propertyId: property.id,
      from: `voice-guest-${Date.now()}`,
      text: "أحتاج تنظيف الغرفة",
      mediaType: "voice",
    });

    const message = await prisma.message.findFirst({
      where: { direction: "inbound", conversation: { guest: { propertyId: property.id } } },
      orderBy: { createdAt: "desc" },
    });
    expect(message?.mediaType).toBe("voice");
    expect(message?.rawText).toBe("أحتاج تنظيف الغرفة");
  });

  it("defaults to mediaType 'text' when mediaType is omitted", async () => {
    const property = await prisma.property.create({ data: { name: "Text Test Hotel" } });

    await handleInbound({
      propertyId: property.id,
      from: `text-guest-${Date.now()}`,
      text: "hello",
    });

    const message = await prisma.message.findFirst({
      where: { direction: "inbound", conversation: { guest: { propertyId: property.id } } },
      orderBy: { createdAt: "desc" },
    });
    expect(message?.mediaType).toBe("text");
  });
});
