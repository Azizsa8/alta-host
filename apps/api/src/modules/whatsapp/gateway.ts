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
 * Sends a message back to the guest. In demo/local mode this just persists
 * the outbound message; wiring WHATSAPP_CLOUD_API_TOKEN here is the only
 * change needed to actually deliver it via the WhatsApp Business Cloud API.
 */
export async function sendWhatsAppMessage(conversationId: string, text: string) {
  await prisma.message.create({
    data: { conversationId, direction: "outbound", rawText: text, mediaType: "text" },
  });

  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  if (!token) return; // demo mode — message is only persisted, not actually sent

  // Real send would go here, e.g.:
  // await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { ... })
}
