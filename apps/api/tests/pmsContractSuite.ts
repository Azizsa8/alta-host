import { describe, it, expect, beforeEach } from "vitest";
import type { PMSAdapter } from "../src/modules/pms/types.js";

export interface PMSContractFixture {
  propertyId: string;
  /** A room number with no confirmed reservation against it. */
  freeRoomNumber: string;
  /** A room number with a confirmed reservation against it. */
  bookedRoomNumber: string;
  /** A guest with an active confirmed reservation. */
  guestId: string;
  /** A guest with no reservation at all. */
  guestWithoutReservationId: string;
  reservationId: string;
  reservationCheckOut: Date;
}

/**
 * Reusable behavioral contract for any PMSAdapter implementation (PMSAdapter
 * per apps/api/src/modules/pms/types.ts). Run this against every adapter —
 * MockPMSAdapter today, a real Oracle OPERA/Mews adapter later — so a new
 * adapter is validated against exactly the same assertions the agents rely
 * on, without any test needing to know which adapter it's running against.
 */
export function runPMSAdapterContractSuite(
  label: string,
  createAdapter: () => PMSAdapter,
  buildFixture: () => Promise<PMSContractFixture>
) {
  describe(`PMSAdapter contract: ${label}`, () => {
    let adapter: PMSAdapter;
    let fixture: PMSContractFixture;

    beforeEach(async () => {
      adapter = createAdapter();
      fixture = await buildFixture();
    });

    it("reports a room with no confirmed reservation as available", async () => {
      const result = await adapter.getAvailability(fixture.propertyId, fixture.freeRoomNumber);
      expect(result.available).toBe(true);
    });

    it("reports a room with a confirmed reservation as unavailable", async () => {
      const result = await adapter.getAvailability(fixture.propertyId, fixture.bookedRoomNumber);
      expect(result.available).toBe(false);
    });

    it("returns a well-formed billing status for a guest", async () => {
      const billing = await adapter.getBillingStatus(fixture.guestId);
      expect(typeof billing.hasValidPaymentMethod).toBe("boolean");
      expect(typeof billing.outstandingBalance).toBe("number");
    });

    it("finds the active reservation for a guest that has one", async () => {
      const reservation = await adapter.getReservationForGuest(fixture.guestId);
      expect(reservation).not.toBeNull();
      expect(reservation?.id).toBe(fixture.reservationId);
      expect(typeof reservation?.roomNumber).toBe("string");
      expect(typeof reservation?.checkOut).toBe("string");
    });

    it("returns null for a guest with no active reservation", async () => {
      const reservation = await adapter.getReservationForGuest(fixture.guestWithoutReservationId);
      expect(reservation).toBeNull();
    });

    it("extends checkout by the given number of hours and reports the new time", async () => {
      const result = await adapter.extendCheckout(fixture.reservationId, 3);
      expect(result.success).toBe(true);
      expect(result.reservationId).toBe(fixture.reservationId);
      const expected = new Date(fixture.reservationCheckOut.getTime() + 3 * 60 * 60 * 1000);
      expect(result.newCheckOut).toBeDefined();
      expect(new Date(result.newCheckOut as string).toISOString()).toBe(expected.toISOString());
    });

    it("persists the extension — a subsequent read reflects the new checkout time", async () => {
      await adapter.extendCheckout(fixture.reservationId, 5);
      const reservation = await adapter.getReservationForGuest(fixture.guestId);
      const expected = new Date(fixture.reservationCheckOut.getTime() + 5 * 60 * 60 * 1000);
      expect(reservation?.checkOut).toBe(expected.toISOString());
    });

    it("fails gracefully (does not throw) for a reservation id that doesn't exist", async () => {
      const result = await adapter.extendCheckout("does-not-exist-at-all", 1);
      expect(result.success).toBe(false);
    });
  });
}
