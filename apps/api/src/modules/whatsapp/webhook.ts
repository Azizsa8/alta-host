import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { resolveConversation, sendWhatsAppMessage } from "./gateway.js";
import { processInboundMessage } from "../orchestrator/index.js";

export const whatsappRouter = Router();

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
});

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
  try {
    // Real WA Cloud API payloads are nested; unwrap the first text message.
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message || message.type !== "text") {
      res.sendStatus(200); // ack anything we don't handle yet (status updates, media, etc.)
      return;
    }

    const propertyId = entry.metadata?.property_id ?? req.query.propertyId;
    const result = await handleInbound({
      propertyId: String(propertyId),
      from: message.from,
      text: message.text.body,
    });
    res.status(200).json(result);
  } catch (err) {
    logger.error({ err }, "webhook error");
    res.sendStatus(500);
  }
});
