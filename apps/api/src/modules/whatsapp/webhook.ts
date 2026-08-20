import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { randomUUID } from "node:crypto";
import { resolveConversation, sendWhatsAppMessage } from "./gateway.js";
import { enqueueInbound } from "../ingest/queue.js";
import { processInboundMessage } from "../orchestrator/index.js";
import { createASREngine } from "../asr/index.js";

export const whatsappRouter = Router();
const asrEngine = createASREngine();

/**
 * Downloads and transcribes a voice message, or returns null if that isn't
 * possible right now (ASR_PROVIDER unset, download failed, transcription
 * failed) — callers treat null exactly like any other unhandled message
 * type: ack the webhook, don't process, log why.
 */
async function transcribeVoiceMessage(fetchAudio: () => Promise<Buffer>, context: string): Promise<string | null> {
  try {
    const audio = await fetchAudio();
    const { text } = await asrEngine.transcribe(audio);
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn({ err, context }, "voice message transcription skipped");
    return null;
  }
}

// GET verification handshake required by the WhatsApp Cloud API.
whatsappRouter.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === (process.env.WHATSAPP_VERIFY_TOKEN ?? "alta-dev-verify-token")) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
});

const InboundPayload = z.object({
  propertyId: z.string(),
  from: z.string(), // guest's WhatsApp ID (phone number)
  text: z.string(),
  guestName: z.string().optional(),
  mediaType: z.enum(["text", "voice"]).optional(),
});

// Raw WhatsApp Cloud API webhook envelope, per Meta's documented shape:
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
// Only the fields this system actually reads are constrained; everything
// else is passed through loosely since Meta's payloads carry many message
// types (image, audio, status updates, etc.) we don't process yet.
// `text` is only required/read when `type === "text"`; other message types
// (image, audio, status updates, reactions, etc.) are validated loosely so
// we can still ack them cleanly without processing them.
const WhatsAppMessage = z
  .object({
    id: z.string().optional(), // Meta's message id — the redelivery-dedupe key
    from: z.string().optional(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    audio: z.object({ id: z.string() }).optional(),
  })
  .passthrough();

/** Two-step Cloud API media fetch: resolve the media id to a signed URL, then download it. */
async function downloadCloudApiMedia(mediaId: string, token: string): Promise<Buffer> {
  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!metaRes.ok) throw new Error(`media metadata fetch failed: ${metaRes.status}`);
  const { url } = (await metaRes.json()) as { url: string };

  const fileRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!fileRes.ok) throw new Error(`media download failed: ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

const WhatsAppValue = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string().optional(),
        property_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    messages: z.array(WhatsAppMessage).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .passthrough();

const WhatsAppChange = z
  .object({
    field: z.string().optional(),
    value: WhatsAppValue,
  })
  .passthrough();

const WhatsAppEntry = z
  .object({
    id: z.string().optional(),
    changes: z.array(WhatsAppChange),
  })
  .passthrough();

export const WhatsAppWebhookEnvelope = z
  .object({
    object: z.string().optional(),
    entry: z.array(WhatsAppEntry),
  })
  .passthrough();

// POST handler shared by the real WhatsApp Cloud API webhook shape and the
// /simulate endpoint the dashboard uses for local demos — both ultimately
// need {propertyId, from, text}, so real payload parsing (WA's nested
// `entry[].changes[].value.messages[]` shape) is normalized to this before
// reaching handleInbound.
export async function handleInbound(payload: z.infer<typeof InboundPayload>) {
  const parsed = InboundPayload.parse(payload);
  const { guest, conversation } = await resolveConversation({
    propertyId: parsed.propertyId,
    whatsappId: parsed.from,
    guestName: parsed.guestName,
  });

  const result = await processInboundMessage({
    propertyId: parsed.propertyId,
    guestId: guest.id,
    conversationId: conversation.id,
    text: parsed.text,
    mediaType: parsed.mediaType,
  });

  // Only immediately-dispatched outcomes go out over WhatsApp now — anything
  // queued_for_review waits for a staff decision (FR-6).
  for (const outcome of result.outcomes) {
    if (outcome.status === "sent" && outcome.reply) {
      await sendWhatsAppMessage(conversation.id, outcome.reply);
    }
  }

  return { guest, conversation, ...result };
}

whatsappRouter.post("/webhook/whatsapp", async (req, res) => {
  const envelopeResult = WhatsAppWebhookEnvelope.safeParse(req.body);
  if (!envelopeResult.success) {
    console.error("webhook: malformed WhatsApp envelope", envelopeResult.error.flatten());
    res.status(400).json({ error: "invalid webhook payload" });
    return;
  }

  try {
    // Real WA Cloud API payloads are nested; unwrap the first message.
    const entry = envelopeResult.data.entry[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message || !message.from) {
      res.sendStatus(200); // ack anything we don't handle yet (status updates, etc.)
      return;
    }

    let text: string;
    let mediaType: "text" | "voice" = "text";

    if (message.type === "text" && message.text) {
      text = message.text.body;
    } else if (message.type === "audio" && message.audio) {
      const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
      if (!token) {
        res.sendStatus(200); // no credentials configured to download the audio at all
        return;
      }
      const transcribed = await transcribeVoiceMessage(
        () => downloadCloudApiMedia(message.audio!.id, token),
        "cloud_api audio message"
      );
      if (!transcribed) {
        res.sendStatus(200);
        return;
      }
      text = transcribed;
      mediaType = "voice";
    } else {
      res.sendStatus(200); // image, status updates, reactions, etc. — not processed yet
      return;
    }

    const propertyId = String(entry?.metadata?.property_id ?? req.query.propertyId);
    // Resolve the conversation now (cheap upserts), then hand the heavy
    // pipeline to the queue — the webhook acks in well under Meta's timeout
    // and redeliveries dedupe on the transport message id.
    const { guest, conversation } = await resolveConversation({
      propertyId,
      whatsappId: message.from,
    });
    await enqueueInbound({
      propertyId,
      guestId: guest.id,
      conversationId: conversation.id,
      text,
      mediaType,
      dedupeKey: message.id ?? randomUUID(),
    });
    res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "webhook error");
    res.sendStatus(500);
  }
});

// WAHA's webhook event shape (dev/demo transport only — see wahaGateway.ts).
// Different from Meta's envelope: flat {event, session, payload}, chat ids
// suffixed "@c.us" instead of bare phone numbers. Validated loosely
// (passthrough) since WAHA emits many event types (session status, message
// acks, etc.) this system doesn't process.
const WahaPayload = z
  .object({
    id: z.string().optional(), // WAHA's message id — the redelivery-dedupe key
    from: z.string().optional(),
    fromMe: z.boolean().optional(),
    body: z.string().optional(),
    hasMedia: z.boolean().optional(),
    media: z.object({ url: z.string().optional(), mimetype: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const WahaWebhookEnvelope = z
  .object({
    event: z.string(),
    session: z.string().optional(),
    payload: WahaPayload.optional(),
  })
  .passthrough();

async function downloadWahaMedia(url: string, apiKey: string | undefined): Promise<Buffer> {
  const res = await fetch(url, {
    headers: apiKey ? { "X-Api-Key": apiKey } : {},
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`waha media download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

whatsappRouter.post("/webhook/waha", async (req, res) => {
  const envelopeResult = WahaWebhookEnvelope.safeParse(req.body);
  if (!envelopeResult.success) {
    console.error("webhook: malformed WAHA envelope", envelopeResult.error.flatten());
    res.status(400).json({ error: "invalid webhook payload" });
    return;
  }

  try {
    const { event, payload } = envelopeResult.data;
    // Outbound echoes (fromMe) and non-message events (session status,
    // acks) are acked without processing, same as unhandled Cloud API types.
    if (event !== "message" || !payload || payload.fromMe || !payload.from) {
      res.sendStatus(200);
      return;
    }

    let text: string;
    let mediaType: "text" | "voice" = "text";

    if (payload.body) {
      text = payload.body;
    } else if (payload.hasMedia && payload.media?.url && (payload.media.mimetype ?? "").startsWith("audio")) {
      const transcribed = await transcribeVoiceMessage(
        () => downloadWahaMedia(payload.media!.url!, process.env.WAHA_API_KEY),
        "waha voice message"
      );
      if (!transcribed) {
        res.sendStatus(200);
        return;
      }
      text = transcribed;
      mediaType = "voice";
    } else {
      res.sendStatus(200); // media type we don't process yet, or an empty body
      return;
    }

    const propertyId = String(req.query.propertyId);
    const { guest, conversation } = await resolveConversation({
      propertyId,
      whatsappId: payload.from.replace(/@c\.us$/, ""),
    });
    await enqueueInbound({
      propertyId,
      guestId: guest.id,
      conversationId: conversation.id,
      text,
      mediaType,
      dedupeKey: payload.id ?? randomUUID(),
    });
    res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "waha webhook error");
    res.sendStatus(500);
  }
});
