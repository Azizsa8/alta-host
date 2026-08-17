import { prisma } from "../../db.js";
import type { AvailabilityResult, BillingStatus, PMSAdapter, ReservationUpdateResult } from "./types.js";

export interface MewsConfig {
  platformAddress: string;
  clientToken: string;
  accessToken: string;
  client: string;
}

async function mewsCall<T>(config: MewsConfig, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.platformAddress.replace(/\/$/, "")}/api/connector/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ClientToken: config.clientToken,
      AccessToken: config.accessToken,
      Client: config.client,
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<unreadable body>");
    throw new Error(`Mews API ${path} responded ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Real PMSAdapter against the Mews Connector API (docs.mews.com/connector-api),
 * verified against Mews's own public demo/sandbox environment — not just
 * typechecked against the documented shapes.
 *
 * One real, load-bearing limitation: the Connector API has no operation to
 * look up a Customer by phone number (customers/getAll and customers/search
 * only filter by id, email, name, or loyalty code — confirmed against the
 * live docs, not assumed). A WhatsApp guest is identified only by phone, so
 * this adapter cannot self-resolve which Mews customer a guest is — it reads
 * `Guest.externalId`, which has to be populated by a separate reservation-
 * sync process (polling or webhook-driven import of upcoming reservations
 * into local Guest/Reservation rows) that doesn't exist in this codebase
 * yet. Every method degrades gracefully (returns null / a safe default)
 * when externalId is unset, rather than guessing.
 */
export class MewsPMSAdapter implements PMSAdapter {
  constructor(private readonly config: MewsConfig) {}

  async getAvailability(propertyId: string, roomNumber: string): Promise<AvailabilityResult> {
    void propertyId; // Mews scopes data by AccessToken (one property per token), not a propertyId param
    try {
      const resourceRes = await mewsCall<{ Resources: Array<{ Id: string; Name: string }> }>(
        this.config,
        "resources/getAll",
        { Names: [roomNumber], Extent: { Resources: true }, Limitation: { Count: 1 } }
      );
      const resource = resourceRes.Resources[0];
      // A room name Mews doesn't recognize is treated as unavailable rather
      // than available — a wrong "yes" here is the worse failure mode.
      if (!resource) return { available: false, roomNumber };

      const reservationRes = await mewsCall<{ Reservations: Array<{ Id: string }> }>(
        this.config,
        "reservations/getAll/2023-06-06",
        { AssignedResourceIds: [resource.Id], States: ["Confirmed", "Started"], Limitation: { Count: 1 } }
      );
      return { available: reservationRes.Reservations.length === 0, roomNumber };
    } catch (err) {
      console.error(`Mews getAvailability failed for room ${roomNumber}`, err);
      return { available: false, roomNumber };
    }
  }

  async getBillingStatus(guestId: string): Promise<BillingStatus> {
    const externalId = await this.resolveExternalId(guestId);
    if (!externalId) return { hasValidPaymentMethod: false, outstandingBalance: 0 };

    try {
      const res = await mewsCall<{ CreditCards: Array<{ IsActive: boolean; State: string }> }>(
        this.config,
        "creditCards/getAll",
        { CustomerIds: [externalId], Limitation: { Count: 10 } }
      );
      const hasValidPaymentMethod = res.CreditCards.some((c) => c.IsActive && c.State === "Enabled");
      // Real balance computation needs summing orderItems/payments across
      // possibly-multiple open bills (bills/getAll + orderItems/getAll +
      // payments/getAll) — real API surface exists, but nothing in this
      // codebase reads outstandingBalance today (only hasValidPaymentMethod,
      // in receptionAgent.ts), so it isn't built until something depends on
      // the actual number. MockPMSAdapter makes the same simplification.
      return { hasValidPaymentMethod, outstandingBalance: 0 };
    } catch (err) {
      console.error(`Mews getBillingStatus failed for guest ${guestId}`, err);
      return { hasValidPaymentMethod: false, outstandingBalance: 0 };
    }
  }

  async extendCheckout(reservationId: string, extraHours: number): Promise<ReservationUpdateResult> {
    try {
      const current = await mewsCall<{ Reservations: Array<{ ScheduledEndUtc: string }> }>(
        this.config,
        "reservations/getAll/2023-06-06",
        { ReservationIds: [reservationId], Limitation: { Count: 1 } }
      );
      const reservation = current.Reservations[0];
      if (!reservation) return { success: false, reservationId };

      const newCheckOut = new Date(new Date(reservation.ScheduledEndUtc).getTime() + extraHours * 60 * 60 * 1000);
      // updateInterval takes the absolute new EndUtc, not a delta — this
      // adapter computes that from the reservation's current time so the
      // interface's own "extend by N hours" contract still holds.
      await mewsCall(this.config, "reservations/updateInterval", {
        ReservationId: reservationId,
        EndUtc: newCheckOut.toISOString(),
        ChargeCancellationFee: false,
      });
      return { success: true, reservationId, newCheckOut: newCheckOut.toISOString() };
    } catch (err) {
      console.error(`Mews extendCheckout failed for reservation ${reservationId}`, err);
      return { success: false, reservationId };
    }
  }

  async getReservationForGuest(guestId: string) {
    const externalId = await this.resolveExternalId(guestId);
    if (!externalId) return null;

    try {
      const res = await mewsCall<{
        Reservations: Array<{ Id: string; AssignedResourceId: string | null; ScheduledEndUtc: string }>;
      }>(this.config, "reservations/getAll/2023-06-06", {
        AccountIds: [externalId],
        States: ["Confirmed", "Started"],
        Limitation: { Count: 1 },
      });
      const reservation = res.Reservations[0];
      if (!reservation || !reservation.AssignedResourceId) return null;

      const resourceRes = await mewsCall<{ Resources: Array<{ Name: string }> }>(this.config, "resources/getAll", {
        ResourceIds: [reservation.AssignedResourceId],
        Extent: { Resources: true },
        Limitation: { Count: 1 },
      });
      const roomNumber = resourceRes.Resources[0]?.Name ?? "unknown";

      return { id: reservation.Id, roomNumber, checkOut: reservation.ScheduledEndUtc };
    } catch (err) {
      console.error(`Mews getReservationForGuest failed for guest ${guestId}`, err);
      return null;
    }
  }

  private async resolveExternalId(guestId: string): Promise<string | null> {
    const guest = await prisma.guest.findUnique({ where: { id: guestId }, select: { externalId: true } });
    return guest?.externalId ?? null;
  }
}
