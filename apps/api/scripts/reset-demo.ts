/**
 * Wipes the demo properties' conversational/operational data back to a
 * pristine state for client demos — load-test noise (hundreds of breached
 * tickets) makes every screen look like a disaster that never happened.
 *
 * Deliberately narrow: only properties passed as args (default: the two
 * seeded demo properties). Staff, credentials, knowledge, brand profile,
 * and agent policies survive — those are demo setup, not demo noise.
 * The audit trail is NOT touched: a tamper-evident chain you casually
 * truncate is neither. Refuses to run against a non-demo-looking DB
 * unless --force is passed.
 *
 * Usage: tsx scripts/reset-demo.ts [propertyId...] [--force]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2).filter((a) => a !== "--force");
const force = process.argv.includes("--force");
const PROPERTIES = args.length > 0 ? args : ["demo-property", "demo-property-2"];

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!force && !/localhost|127\.0\.0\.1|@db:/.test(dbUrl)) {
    console.error("DATABASE_URL does not look local — refusing without --force.");
    process.exit(1);
  }

  for (const propertyId of PROPERTIES) {
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) {
      console.log(`- ${propertyId}: not found, skipping`);
      continue;
    }

    // FK-safe order: leaves first, then up the chain.
    const guestFilter = { message: { conversation: { guest: { propertyId } } } };
    const counts: Record<string, number> = {};

    counts.agentActions = (
      await prisma.agentAction.deleteMany({ where: { ticket: { intent: guestFilter } } })
    ).count;
    counts.tickets = (await prisma.ticket.deleteMany({ where: { intent: guestFilter } })).count;
    counts.reviewItems = (await prisma.reviewItem.deleteMany({ where: { intent: guestFilter } })).count;
    counts.intents = (
      await prisma.intent.deleteMany({ where: { message: { conversation: { guest: { propertyId } } } } })
    ).count;
    counts.messages = (
      await prisma.message.deleteMany({ where: { conversation: { guest: { propertyId } } } })
    ).count;
    counts.conversations = (
      await prisma.conversation.deleteMany({ where: { guest: { propertyId } } })
    ).count;
    counts.reservations = (await prisma.reservation.deleteMany({ where: { propertyId } })).count;
    counts.guests = (await prisma.guest.deleteMany({ where: { propertyId } })).count;
    counts.workOrderUpdates = (
      await prisma.workOrderUpdate.deleteMany({ where: { workOrder: { propertyId } } })
    ).count;
    counts.workOrders = (await prisma.workOrder.deleteMany({ where: { propertyId } })).count;
    counts.events = (await prisma.altaEvent.deleteMany({ where: { propertyId } })).count;
    counts.agentRuns = (await prisma.agentRun.deleteMany({ where: { propertyId } })).count;
    counts.reviews = (await prisma.review.deleteMany({ where: { propertyId } })).count;
    counts.googleReviews = (await prisma.googleReview.deleteMany({ where: { propertyId } })).count;
    counts.contentItems = (await prisma.contentItem.deleteMany({ where: { propertyId } })).count;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`✓ ${propertyId}: removed ${total} rows`, counts);
  }

  console.log("\nRun `npm run db:seed` to restore the demo guests and reservations.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
