// Standalone runtime check — NOT a unit test, deliberately outside any test
// framework, same pattern as verify-tenant-isolation.ts. Exercises
// MewsPMSAdapter against Mews's real demo/sandbox API (not a mock, not a
// stub) using a customer + reservation this script creates itself, so every
// assertion is against data under our own control rather than the shared
// demo sandbox's constantly-changing pool of other testers' bookings.
//
// Usage:
//   npx tsx apps/api/scripts/verify-mews-adapter.ts
//
// Env overrides (defaults are Mews's own published public demo credentials):
//   MEWS_PLATFORM_ADDRESS  default https://api.mews-demo.com
//   MEWS_CLIENT_TOKEN      default the shared demo ClientToken
//   MEWS_ACCESS_TOKEN      default the shared demo AccessToken

import { PrismaClient } from "@prisma/client";
import { MewsPMSAdapter } from "../src/modules/pms/mewsAdapter.js";

const config = {
  platformAddress: process.env.MEWS_PLATFORM_ADDRESS ?? "https://api.mews-demo.com",
  clientToken: process.env.MEWS_CLIENT_TOKEN ?? "E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D",
  accessToken: process.env.MEWS_ACCESS_TOKEN ?? "C66EF7B239D24632943D115EDE9CB810-EA00F8FD8294692C940F6B5A8F9453D",
  client: "ALTA-verify-script 1.0.0",
};

async function mewsCall<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.platformAddress}/api/connector/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ClientToken: config.clientToken,
      AccessToken: config.accessToken,
      Client: config.client,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Mews API ${path} responded ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok — ${label}`);
    passed++;
  } else {
    console.error(`  FAIL — ${label}${detail ? ` (${detail})` : ""}`);
    failed++;
  }
}

async function main() {
  console.log(`Verifying MewsPMSAdapter against ${config.platformAddress} (real demo API)\n`);

  console.log("Setting up: creating a real test customer + reservation...");
  const customer = await mewsCall<{ Id: string }>("customers/add", {
    FirstName: "ALTA",
    LastName: `Verify-${Date.now()}`,
    Email: `alta-verify-${Date.now()}@example.invalid`,
    OverwriteExisting: true,
  });

  // Reused from a real reservation already present in the shared demo data
  // (fetched via reservations/getAll during development) — Service/Rate/
  // Category ids are enterprise config, not something this script creates.
  const SERVICE_ID = "7d35e0b2-9739-411e-9078-b3b7013dc9a3";
  const RATE_ID = "8704e4f1-fec7-46ce-b88d-b3b7013dc9de";
  const CATEGORY_ID = "be5a5d7b-e754-452f-a645-b3b7013ef0d9";
  const AGE_CATEGORY_ID = "0a58cefc-d137-4634-95fe-b3b7013dc9d9";

  const startUtc = new Date(Date.now() + (200 + Math.floor(Math.random() * 100)) * 24 * 60 * 60 * 1000); // far out + randomized, avoids exhausting shared demo inventory across repeated runs
  const endUtc = new Date(startUtc.getTime() + 2 * 24 * 60 * 60 * 1000);

  const added = await mewsCall<{ Reservations: Array<{ Reservation: { Id: string; AssignedResourceId: string; EndUtc: string } }> }>(
    "reservations/add",
    {
      ServiceId: SERVICE_ID,
      SendConfirmationEmail: false,
      Reservations: [
        {
          State: "Confirmed",
          StartUtc: startUtc.toISOString(),
          EndUtc: endUtc.toISOString(),
          CustomerId: customer.Id,
          RequestedCategoryId: CATEGORY_ID,
          RateId: RATE_ID,
          Notes: "ALTA MewsPMSAdapter verification — safe to delete",
          PersonCounts: [{ AgeCategoryId: AGE_CATEGORY_ID, Count: 1 }],
        },
      ],
    }
  );
  const reservation = added.Reservations[0].Reservation;
  const resourceRes = await mewsCall<{ Resources: Array<{ Name: string }> }>("resources/getAll", {
    ResourceIds: [reservation.AssignedResourceId],
    Extent: { Resources: true },
    Limitation: { Count: 1 },
  });
  const roomNumber = resourceRes.Resources[0].Name;
  console.log(`  created customer ${customer.Id}, reservation ${reservation.Id} in ${roomNumber}\n`);

  const prisma = new PrismaClient();
  const property = await prisma.property.create({ data: { name: "Mews Verify Property" } });
  const guest = await prisma.guest.create({
    data: {
      propertyId: property.id,
      whatsappId: `mews-verify-${Date.now()}`,
      externalId: customer.Id,
    },
  });

  const adapter = new MewsPMSAdapter(config);

  // Mews's AccountIds-filtered reservation search has a brief (~1-2s)
  // propagation delay after a reservation is first created — confirmed by
  // hand against the live API, not assumed. Direct ReservationId lookups
  // (used inside extendCheckout below) don't have this lag. Retrying here
  // is a property of freshly-created test data, not something the adapter
  // itself needs to handle in real usage — a sync process would never be
  // querying milliseconds after a booking lands.
  console.log("getReservationForGuest — finding the reservation we just created:");
  let found: Awaited<ReturnType<typeof adapter.getReservationForGuest>> = null;
  for (let attempt = 1; attempt <= 5 && !found; attempt++) {
    found = await adapter.getReservationForGuest(guest.id);
    if (!found) await new Promise((r) => setTimeout(r, 1000));
  }
  check("returns a reservation", found !== null);
  check("reservation id matches", found?.id === reservation.Id, `got ${found?.id}`);
  check("room number matches", found?.roomNumber === roomNumber, `got ${found?.roomNumber}`);
  check("checkOut matches", found?.checkOut === reservation.EndUtc, `got ${found?.checkOut}`);

  console.log("\ngetAvailability — the room we just booked should be unavailable:");
  const bookedAvailability = await adapter.getAvailability(property.id, roomNumber);
  check("booked room reports unavailable", bookedAvailability.available === false);

  console.log("\ngetAvailability — a room name Mews doesn't recognize:");
  const unknownAvailability = await adapter.getAvailability(property.id, "NOT-A-REAL-ROOM-NAME-12345");
  check("unknown room reports unavailable (safe default)", unknownAvailability.available === false);

  console.log("\ngetBillingStatus — a customer with no credit card on file:");
  const billing = await adapter.getBillingStatus(guest.id);
  check("hasValidPaymentMethod is false", billing.hasValidPaymentMethod === false);
  check("outstandingBalance is a number", typeof billing.outstandingBalance === "number");

  console.log("\ngetBillingStatus — a guest with no externalId (no sync has run):");
  const guestNoLink = await prisma.guest.create({
    data: { propertyId: property.id, whatsappId: `mews-verify-nolink-${Date.now()}` },
  });
  const billingNoLink = await adapter.getBillingStatus(guestNoLink.id);
  check("degrades to hasValidPaymentMethod=false, not a crash", billingNoLink.hasValidPaymentMethod === false);
  const reservationNoLink = await adapter.getReservationForGuest(guestNoLink.id);
  check("degrades to null, not a crash", reservationNoLink === null);

  console.log("\nextendCheckout — real mutation against the reservation we created:");
  const originalCheckOut = new Date(reservation.EndUtc);
  const extended = await adapter.extendCheckout(reservation.Id, 3);
  check("success is true", extended.success === true);
  const expectedNewCheckOut = new Date(originalCheckOut.getTime() + 3 * 60 * 60 * 1000);
  check(
    "newCheckOut is exactly +3 hours",
    extended.newCheckOut === expectedNewCheckOut.toISOString(),
    `got ${extended.newCheckOut}, expected ${expectedNewCheckOut.toISOString()}`
  );

  console.log("\nextendCheckout — persistence check (real re-read from Mews):");
  // Same AccountIds propagation lag as the creation check above — retry
  // rather than assume the first read reflects a mutation made a moment ago.
  // Compare by timestamp, not string equality: Mews returns second-precision
  // ISO strings ("...30Z") while JS's toISOString() always appends
  // milliseconds ("...30.000Z") — same instant, different string.
  let reread: Awaited<ReturnType<typeof adapter.getReservationForGuest>> = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    reread = await adapter.getReservationForGuest(guest.id);
    if (reread && new Date(reread.checkOut).getTime() === expectedNewCheckOut.getTime()) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(
    "re-read reflects the extension",
    !!reread && new Date(reread.checkOut).getTime() === expectedNewCheckOut.getTime(),
    `got ${reread?.checkOut}`
  );

  console.log("\nextendCheckout — a reservation id that doesn't exist:");
  const failedExtend = await adapter.extendCheckout("00000000-0000-0000-0000-000000000000", 1);
  check("fails gracefully, does not throw", failedExtend.success === false);

  await prisma.guest.deleteMany({ where: { propertyId: property.id } });
  await prisma.property.delete({ where: { id: property.id } });
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("verification script crashed:", err);
  process.exit(1);
});
