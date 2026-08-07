import { prisma } from "../../db.js";

/**
 * Resolves (or creates) the Guest + Conversation for an inbound WhatsApp
 * message, and finds/creates the default demo Property if none is passed —
 * this is the "one WhatsApp number per property" mapping described in the
 * architecture doc's Layer 01.
 */
export async function resolveConversation(params: { propertyId: string; whatsappId: string; guestName?: string }) {
  let guest = await prisma.guest.findUnique({ where: { whatsappId: params.whatsappId } });
  if (!guest) {
    guest = await prisma.guest.create({
      data: {
        propertyId: params.propertyId,
        whatsappId: params.whatsappId,
        name: params.guestName,
      },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { guestId: guest.id },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({ data: { guestId: guest.id } });
  }

  return { guest, conversation };
}

/**
 * Sends a message back to the guest. In demo/local mode (no
 * WHATSAPP_CLOUD_API_TOKEN set) this just persists the outbound message.
 * When WHATSAPP_CLOUD_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID are both set,
 * it also actually delivers the message via the WhatsApp Business Cloud API.
 */
export async function sendWhatsAppMessage(conversationId: string, text: string) {
  const message = await prisma.message.create({
    data: { conversationId, direction: "outbound", rawText: text, mediaType: "text" },
  });

  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return; // demo mode — message is only persisted, not actually sent

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { guest: true },
  });
  const to = conversation?.guest.whatsappId;
  if (!to) {
    console.error(`whatsapp send: no guest whatsappId found for conversation ${conversationId}, skipping delivery`);
    return;
  }

  await deliverToCloudApi({ token, phoneNumberId, to, text, messageId: message.id });
}

async function deliverToCloudApi(params: {
  token: string;
  phoneNumberId: string;
  to: string;
  text: string;
  messageId: string;
}) {
  const { token, phoneNumberId, to, text, messageId } = params;
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });

  const attempt = async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "<unreadable body>");
      throw new Error(`WhatsApp Cloud API responded ${response.status}: ${detail}`);
    }
    return response;
  };

  try {
    await attempt();
  } catch (firstErr) {
    console.error(`whatsapp send failed for message ${messageId} (attempt 1), retrying once`, firstErr);
    try {
      await attempt();
    } catch (secondErr) {
      // Message is already persisted regardless of delivery outcome; log
      // clearly and move on rather than crashing the request.
      console.error(`whatsapp send failed for message ${messageId} (attempt 2), giving up`, secondErr);
    }
  }
}
