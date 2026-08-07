import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { createPMSAdapter } from "../src/modules/pms/mockAdapter.js";
import { runPMSAdapterContractSuite, type PMSContractFixture } from "./pmsContractSuite.js";

async function buildFixture(): Promise<PMSContractFixture> {
  const property = await prisma.property.create({ data: { name: `Contract Test Hotel ${randomUUID()}` } });
  const guest = await prisma.guest.create({
    data: { propertyId: property.id, whatsappId: `contract-${randomUUID()}` },
  });
  const guestWithoutReservation = await prisma.guest.create({
    data: { propertyId: property.id, whatsappId: `contract-none-${randomUUID()}` },
  });

  const checkIn = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const freeRoomNumber = `FREE-${randomUUID().slice(0, 8)}`;
  const bookedRoomNumber = `BOOKED-${randomUUID().slice(0, 8)}`;

  const reservation = await prisma.reservation.create({
    data: {
      guestId: guest.id,
      propertyId: property.id,
      roomNumber: bookedRoomNumber,
      checkIn,
      checkOut,
      status: "confirmed",
    },
  });

  return {
    propertyId: property.id,
    freeRoomNumber,
    bookedRoomNumber,
    guestId: guest.id,
    guestWithoutReservationId: guestWithoutReservation.id,
    reservationId: reservation.id,
    reservationCheckOut: checkOut,
  };
}

// MockPMSAdapter is today's only implementation — this is the suite any
// future Oracle OPERA/Mews adapter must pass unmodified.
runPMSAdapterContractSuite("MockPMSAdapter", createPMSAdapter, buildFixture);
