import { prisma } from "../../db.js";
import { createWhatsAppGateway } from "./gatewayFactory.js";

const whatsAppGateway = createWhatsAppGateway();

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
 * Sends a message back to the guest. Always persists the outbound message;
 * actual delivery is delegated to whichever WhatsAppGateway WHATSAPP_PROVIDER
 * selects (see gatewayFactory.ts) — CloudApiGateway no-ops in demo/local mode
 * when no credentials are configured.
 */
export async function sendWhatsAppMessage(conversationId: string, text: string) {
  const message = await prisma.message.create({
    data: { conversationId, direction: "outbound", rawText: text, mediaType: "text" },
  });

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { guest: true },
  });
  const to = conversation?.guest.whatsappId;
  if (!to) {
    console.error(`whatsapp send: no guest whatsappId found for conversation ${conversationId}, skipping delivery`);
    return;
  }

  await whatsAppGateway.send({ to, text, messageId: message.id });
}
