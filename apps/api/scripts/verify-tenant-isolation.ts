// Standalone runtime check — NOT a unit test, deliberately outside any test
// framework. Run against a live API server (npm run dev:api) after seeding
// (npm run db:seed --workspace apps/api), which now creates two properties.
//
// Verifies that per-property scoping actually holds across a second tenant,
// something the codebase has never been checked against before (only one
// demo property ever existed). Exercises the real HTTP surface with native
// fetch — no extra dependencies, no Prisma client of its own.
//
// Usage:
//   npx tsx apps/api/scripts/verify-tenant-isolation.ts
//
// Env overrides:
//   API_BASE_URL   default http://localhost:4317
//   PROPERTY_ID_1  default demo-property     (must match prisma/seed.ts)
//   PROPERTY_ID_2  default demo-property-2   (must match prisma/seed.ts)
//   GUEST_WA_1     default 9665xxxxxxxx
//   GUEST_WA_2     default 9665yyyyyyyy

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4317";
const PROPERTY_ID_1 = process.env.PROPERTY_ID_1 ?? "demo-property";
const PROPERTY_ID_2 = process.env.PROPERTY_ID_2 ?? "demo-property-2";
const GUEST_WA_1 = process.env.GUEST_WA_1 ?? "9665xxxxxxxx";
const GUEST_WA_2 = process.env.GUEST_WA_2 ?? "9665yyyyyyyy";

interface TicketGuestRef {
  propertyId?: string;
}
interface TicketDto {
  id: string;
  intent?: {
    message?: {
      conversation?: {
        guest?: TicketGuestRef;
      };
    };
  };
}
interface GuestDto {
  id: string;
  propertyId?: string;
}
interface MetricsDto {
  totalTickets: number;
  openTickets: number;
  urgentIntents: number;
  guestCount: number;
  pendingReviews: number;
}

let hardFailures = 0;
let knownIssues = 0;

function pass(msg: string): void {
  console.log(`  PASS  ${msg}`);
}
function fail(msg: string): void {
  hardFailures++;
  console.error(`  FAIL  ${msg}`);
}
function warnKnownIssue(msg: string): void {
  knownIssues++;
  console.warn(`  WARN  ${msg}`);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function simulate(propertyId: string, from: string, text: string, guestName: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyId, from, text, guestName }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/simulate -> ${res.status} ${res.statusText} (${await res.text()})`);
  }
}

async function checkServerUp(): Promise<void> {
  try {
    await getJson("/api/properties");
  } catch (err) {
    console.error(
      `\nCannot reach API at ${API_BASE_URL}. Is it running? (npm run dev:api)\n` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}

async function checkTicketsIsolation(): Promise<void> {
  console.log("\n[1/3] /api/tickets isolation");
  const [tickets1, tickets2] = await Promise.all([
    getJson<TicketDto[]>(`/api/tickets?propertyId=${encodeURIComponent(PROPERTY_ID_1)}`),
    getJson<TicketDto[]>(`/api/tickets?propertyId=${encodeURIComponent(PROPERTY_ID_2)}`),
  ]);

  const ids1 = new Set(tickets1.map((t) => t.id));
  const ids2 = new Set(tickets2.map((t) => t.id));
  const overlap = [...ids1].filter((id) => ids2.has(id));

  if (overlap.length === 0) {
    pass(`no ticket ID overlap between property 1 (${ids1.size} tickets) and property 2 (${ids2.size} tickets)`);
  } else {
    fail(`ticket ID overlap between properties: ${overlap.join(", ")}`);
  }

  // Stronger check: every ticket returned for property N actually belongs
  // to property N (via the nested intent->message->conversation->guest
  // relation the /tickets route includes).
  const mismatched1 = tickets1.filter((t) => t.intent?.message?.conversation?.guest?.propertyId !== PROPERTY_ID_1);
  const mismatched2 = tickets2.filter((t) => t.intent?.message?.conversation?.guest?.propertyId !== PROPERTY_ID_2);
  if (mismatched1.length === 0 && mismatched2.length === 0) {
    pass("every returned ticket's nested guest.propertyId matches the queried propertyId");
  } else {
    fail(
      `tickets returned with mismatched propertyId — property1 query: ${mismatched1.length} wrong, ` +
        `property2 query: ${mismatched2.length} wrong`
    );
  }
}

async function checkGuestsIsolation(): Promise<void> {
  console.log("\n[2/3] /api/guests isolation");
  const [guests1, guests2] = await Promise.all([
    getJson<GuestDto[]>(`/api/guests?propertyId=${encodeURIComponent(PROPERTY_ID_1)}`),
    getJson<GuestDto[]>(`/api/guests?propertyId=${encodeURIComponent(PROPERTY_ID_2)}`),
  ]);

  const ids1 = new Set(guests1.map((g) => g.id));
  const ids2 = new Set(guests2.map((g) => g.id));
  const overlap = [...ids1].filter((id) => ids2.has(id));

  if (overlap.length === 0) {
    pass(`no guest ID overlap between property 1 (${ids1.size} guests) and property 2 (${ids2.size} guests)`);
  } else {
    fail(`guest ID overlap between properties: ${overlap.join(", ")}`);
  }

  const mismatched1 = guests1.filter((g) => g.propertyId !== PROPERTY_ID_1);
  const mismatched2 = guests2.filter((g) => g.propertyId !== PROPERTY_ID_2);
  if (mismatched1.length === 0 && mismatched2.length === 0) {
    pass("every returned guest's propertyId matches the queried propertyId");
  } else {
    fail(
      `guests returned with mismatched propertyId — property1 query: ${mismatched1.length} wrong, ` +
        `property2 query: ${mismatched2.length} wrong`
    );
  }
}

// Generates N distinct "urgent" inbound messages for a property via the
// simulate pipeline (each is both a maintenance issue -> ticket, and
// urgent-sentiment -> Intent.urgency = "urgent"). Distinct wording per call
// avoids relying on any particular NLU dedup behavior.
async function generateUrgentIntents(propertyId: string, from: string, guestName: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await simulate(
      propertyId,
      from,
      `URGENT!!! The AC is broken and leaking in my room, this is unacceptable, fix it now (${propertyId}-${i}-${Date.now()})`,
      guestName
    );
  }
}

async function checkMetricsIsolation(): Promise<void> {
  console.log("\n[3/3] /api/metrics isolation (urgentIntents)");

  const [before1, before2] = await Promise.all([
    getJson<MetricsDto>(`/api/metrics?propertyId=${encodeURIComponent(PROPERTY_ID_1)}`),
    getJson<MetricsDto>(`/api/metrics?propertyId=${encodeURIComponent(PROPERTY_ID_2)}`),
  ]);

  // Asymmetric counts (1 vs 2) so a correctly-scoped urgentIntents count
  // must differ between properties, and a global/unscoped count is
  // distinguishable from either per-property count.
  const NEW_URGENT_1 = 1;
  const NEW_URGENT_2 = 2;
  await Promise.all([
    generateUrgentIntents(PROPERTY_ID_1, GUEST_WA_1, "Demo Guest", NEW_URGENT_1),
    generateUrgentIntents(PROPERTY_ID_2, GUEST_WA_2, "Demo Guest 2", NEW_URGENT_2),
  ]);

  const [after1, after2] = await Promise.all([
    getJson<MetricsDto>(`/api/metrics?propertyId=${encodeURIComponent(PROPERTY_ID_1)}`),
    getJson<MetricsDto>(`/api/metrics?propertyId=${encodeURIComponent(PROPERTY_ID_2)}`),
  ]);

  const delta1 = after1.urgentIntents - before1.urgentIntents;
  const delta2 = after2.urgentIntents - before2.urgentIntents;

  console.log(
    `  urgentIntents before -> after: property1 ${before1.urgentIntents} -> ${after1.urgentIntents} ` +
      `(delta ${delta1}, expected ${NEW_URGENT_1}); property2 ${before2.urgentIntents} -> ${after2.urgentIntents} ` +
      `(delta ${delta2}, expected ${NEW_URGENT_2})`
  );

  // totalTickets/openTickets/guestCount/pendingReviews are all scoped
  // correctly already — sanity-check that while we're here, since we just
  // created real tickets for both properties.
  if (after1.totalTickets > before1.totalTickets && after2.totalTickets > before2.totalTickets) {
    pass("totalTickets increased for both properties independently (unaffected by the urgentIntents bug)");
  } else {
    fail("totalTickets did not increase as expected after creating maintenance tickets for both properties");
  }

  if (delta1 === NEW_URGENT_1 && delta2 === NEW_URGENT_2) {
    pass("urgentIntents is correctly scoped by propertyId — the known issue appears to be FIXED");
  } else if (delta1 === delta2 && delta1 === NEW_URGENT_1 + NEW_URGENT_2) {
    warnKnownIssue(
      "ISOLATION BREACH: /api/metrics urgentIntents is NOT scoped by propertyId — " +
        `both properties report the same combined delta (${delta1}) instead of their own ` +
        `(expected property1=${NEW_URGENT_1}, property2=${NEW_URGENT_2}). ` +
        "Root cause: apps/api/src/modules/api/routes.ts /metrics handler computes " +
        '`prisma.intent.count({ where: { urgency: "urgent" } })` without a propertyId filter, ' +
        "unlike every other field in the same response. Known issue, owned by a separate unit — not fixed here."
    );
  } else {
    fail(
      `urgentIntents delta did not match either the "fixed" or the "known bug" pattern — ` +
        `got delta1=${delta1}, delta2=${delta2}, expected fixed=(${NEW_URGENT_1},${NEW_URGENT_2}) or ` +
        `buggy=(${NEW_URGENT_1 + NEW_URGENT_2},${NEW_URGENT_1 + NEW_URGENT_2}). This looks like a NEW, unexpected behavior.`
    );
  }
}

async function main(): Promise<void> {
  console.log(`Verifying multi-tenant isolation against ${API_BASE_URL}`);
  console.log(`  property 1: ${PROPERTY_ID_1}`);
  console.log(`  property 2: ${PROPERTY_ID_2}`);

  await checkServerUp();
  await checkTicketsIsolation();
  await checkGuestsIsolation();
  await checkMetricsIsolation();

  console.log("\n---");
  console.log(`${hardFailures} hard failure(s), ${knownIssues} known issue(s) surfaced.`);

  if (hardFailures > 0) {
    console.error("RESULT: FAIL — unexpected isolation problem(s) found.");
    process.exit(1);
  }
  if (knownIssues > 0) {
    console.warn("RESULT: WARN — all checks behaved as expected, including the known urgentIntents leak.");
    process.exit(0);
  }
  console.log("RESULT: PASS — full isolation confirmed, including urgentIntents (known issue appears fixed).");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nVerification script crashed:", err);
  process.exit(1);
});
