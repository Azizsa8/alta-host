import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import type { IntentType } from "../src/modules/nlu/types.js";

/** A fresh Property + Guest + confirmed Reservation, isolated per test via random ids. */
export async function seedGuestWithReservation(
  overrides: { checkOut?: Date; checkIn?: Date; roomNumber?: string } = {}
) {
  const property = await prisma.property.create({
    data: { name: `Test Hotel ${randomUUID()}` },
  });
  const guest = await prisma.guest.create({
    data: { propertyId: property.id, whatsappId: `guest-${randomUUID()}` },
  });
  const checkIn = overrides.checkIn ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const checkOut = overrides.checkOut ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
  const reservation = await prisma.reservation.create({
    data: {
      guestId: guest.id,
      propertyId: property.id,
      roomNumber: overrides.roomNumber ?? `R-${randomUUID().slice(0, 8)}`,
      checkIn,
      checkOut,
      status: "confirmed",
    },
  });
  const conversation = await prisma.conversation.create({ data: { guestId: guest.id } });

  return { property, guest, reservation, conversation };
}

export async function seedOnShiftStaff(propertyId: string, role: string) {
  return prisma.staffMember.create({
    data: { propertyId, name: `Staff ${randomUUID().slice(0, 8)}`, role, onShift: true },
  });
}

/** Creates a Message + Intent row so a Ticket/ReviewItem can legally reference intentId. */
export async function seedIntentRecord(params: {
  conversationId: string;
  type: IntentType | string;
  params?: Record<string, unknown>;
  text?: string;
}) {
  const message = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      direction: "inbound",
      rawText: params.text ?? "test message",
      mediaType: "text",
    },
  });
  const intent = await prisma.intent.create({
    data: {
      messageId: message.id,
      type: params.type,
      params: JSON.stringify(params.params ?? {}),
    },
  });
  return { message, intent };
}
