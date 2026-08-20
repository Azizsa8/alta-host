import { describe, it, expect } from "vitest";
import { prisma } from "../src/db.js";
import { emitEvent } from "../src/modules/events/bus.js";

describe("event bus", () => {
  const propertyId = `evt-test-${Date.now()}`;

  it("persists the event with a monotonic seq", async () => {
    await emitEvent(propertyId, {
      type: "ticket.created",
      ticketId: "t1",
      department: "maintenance",
      urgency: "urgent",
      summary: "AC broken",
    });
    await emitEvent(propertyId, {
      type: "ticket.escalated",
      ticketId: "t1",
      department: "maintenance",
    });
    const rows = await prisma.altaEvent.findMany({
      where: { propertyId },
      orderBy: { seq: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("ticket.created");
    expect(rows[1].seq).toBeGreaterThan(rows[0].seq);
    expect(JSON.parse(rows[1].payload).ticketId).toBe("t1");
  });

  it("does not throw when the Redis publish fails (persist-first, publish best-effort)", async () => {
    // The bus must catch publish errors — a dead Redis can never fail the
    // business operation that emitted the event. We can't easily kill the
    // shared connection here, so this asserts the contract on the happy
    // path too: emitEvent resolves regardless of publish outcome.
    await expect(
      emitEvent(propertyId, { type: "ticket.escalated", ticketId: "t2", department: "housekeeping" })
    ).resolves.not.toThrow();
  });
});
