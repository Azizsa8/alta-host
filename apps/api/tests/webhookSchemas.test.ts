import { describe, it, expect } from "vitest";
import { WhatsAppWebhookEnvelope, WahaWebhookEnvelope } from "../src/modules/whatsapp/webhook.js";

describe("WhatsAppWebhookEnvelope — Cloud API payload validation", () => {
  it("accepts a real text-message envelope", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "123", property_id: "demo-property" },
                messages: [{ from: "966501112222", type: "text", text: { body: "hello" } }],
              },
            },
          ],
        },
      ],
    };
    expect(WhatsAppWebhookEnvelope.safeParse(payload).success).toBe(true);
  });

  it("accepts an audio-message envelope (validated loosely via passthrough)", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "966501112222", type: "audio", audio: { id: "media-1" } }],
              },
            },
          ],
        },
      ],
    };
    expect(WhatsAppWebhookEnvelope.safeParse(payload).success).toBe(true);
  });

  it("rejects a malformed envelope missing the required entry[].changes array", () => {
    const payload = { entry: [{ id: "entry-1" }] };
    expect(WhatsAppWebhookEnvelope.safeParse(payload).success).toBe(false);
  });

  it("rejects a payload that isn't the WhatsApp envelope shape at all", () => {
    expect(WhatsAppWebhookEnvelope.safeParse({ garbage: true }).success).toBe(false);
  });
});

describe("WahaWebhookEnvelope — WAHA payload validation", () => {
  it("accepts a real inbound text-message event", () => {
    const payload = {
      event: "message",
      session: "default",
      payload: { from: "966501112222@c.us", fromMe: false, body: "hello" },
    };
    expect(WahaWebhookEnvelope.safeParse(payload).success).toBe(true);
  });

  it("accepts a voice-note event carrying media (validated loosely via passthrough)", () => {
    const payload = {
      event: "message",
      payload: {
        from: "966501112222@c.us",
        fromMe: false,
        hasMedia: true,
        media: { url: "http://waha:3000/api/files/abc.oga", mimetype: "audio/ogg" },
      },
    };
    expect(WahaWebhookEnvelope.safeParse(payload).success).toBe(true);
  });

  it("accepts non-message events (session status, acks) since `event` is the only required field", () => {
    expect(WahaWebhookEnvelope.safeParse({ event: "session.status", session: "default" }).success).toBe(true);
  });

  it("rejects a payload missing the required `event` field", () => {
    expect(WahaWebhookEnvelope.safeParse({ session: "default", payload: {} }).success).toBe(false);
  });
});
