import { prisma } from "../../db.js";
import type { AvailabilityResult, BillingStatus, PMSAdapter, ReservationUpdateResult } from "./types.js";

// Stands in for Oracle OPERA / Mews during local dev and the pilot's early
// weeks, before the real adapter is wired up. Reads/writes the same
// Reservation table a real adapter would sync from the PMS.
export class MockPMSAdapter implements PMSAdapter {
  async getAvailability(propertyId: string, roomNumber: string): Promise<AvailabilityResult> {
    const clash = await prisma.reservation.findFirst({
      where: { propertyId, roomNumber, status: "confirmed" },
    });
    return { available: !clash, roomNumber };
  }

  async getBillingStatus(guestId: string): Promise<BillingStatus> {
    // Mock mode assumes every seeded guest has a valid card on file.
    void guestId;
    return { hasValidPaymentMethod: true, outstandingBalance: 0 };
  }

  async extendCheckout(reservationId: string, extraHours: number): Promise<ReservationUpdateResult> {
    const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) return { success: false, reservationId };

    const newCheckOut = new Date(reservation.checkOut.getTime() + extraHours * 60 * 60 * 1000);
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { checkOut: newCheckOut },
    });
    return { success: true, reservationId, newCheckOut: newCheckOut.toISOString() };
  }

  async getReservationForGuest(guestId: string) {
    const reservation = await prisma.reservation.findFirst({
      where: { guestId, status: "confirmed" },
      orderBy: { checkIn: "desc" },
    });
    if (!reservation) return null;
    return {
      id: reservation.id,
      roomNumber: reservation.roomNumber,
      checkOut: reservation.checkOut.toISOString(),
    };
  }
}

export function createPMSAdapter(): PMSAdapter {
  // PMS_PROVIDER selects the real adapter once one exists (e.g. "opera", "mews").
  // Only "mock" is implemented today.
  return new MockPMSAdapter();
}
