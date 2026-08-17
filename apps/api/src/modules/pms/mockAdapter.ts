import { prisma } from "../../db.js";
import { MewsPMSAdapter } from "./mewsAdapter.js";
import type { AvailabilityResult, BillingStatus, PMSAdapter, ReservationUpdateResult } from "./types.js";

// Stands in for a real PMS during local dev and demos (PMS_PROVIDER=mock,
// the default) — see mewsAdapter.ts for the real Mews implementation.
// Reads/writes the same
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
  const provider = process.env.PMS_PROVIDER ?? "mock";

  if (provider === "mews") {
    const clientToken = process.env.MEWS_CLIENT_TOKEN;
    const accessToken = process.env.MEWS_ACCESS_TOKEN;
    if (clientToken && accessToken) {
      return new MewsPMSAdapter({
        platformAddress: process.env.MEWS_PLATFORM_ADDRESS ?? "https://api.mews-demo.com",
        clientToken,
        accessToken,
        client: process.env.MEWS_CLIENT_NAME ?? "ALTA 1.0.0",
      });
    }
    console.warn(
      "PMS_PROVIDER=mews but MEWS_CLIENT_TOKEN/MEWS_ACCESS_TOKEN are unset — falling back to MockPMSAdapter. Set both to use the real Mews adapter."
    );
  }

  // Oracle OPERA has no equivalent adapter yet — needs a real pilot's
  // credentials and API access level to build against.
  return new MockPMSAdapter();
}
