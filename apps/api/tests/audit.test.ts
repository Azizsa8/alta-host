import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { recordAudit, verifyAuditChain } from "../src/modules/audit/service.js";

/**
 * The value of a tamper-evident trail is entirely in whether tampering is
 * actually detected. These tests attack the chain the way someone covering
 * their tracks would: edit an entry, then delete one.
 */
describe("audit trail", () => {
  beforeAll(async () => {
    // Chain verification walks from the very beginning, so the table must
    // start clean or unrelated rows from other suites would be included.
    await prisma.auditEvent.deleteMany({});
  });

  it("chains entries and verifies clean", async () => {
    await recordAudit({ action: "auth.login", actorName: "fahad", propertyId: "p1" });
    await recordAudit({
      action: "review.approve",
      actorName: "fahad",
      propertyId: "p1",
      resourceType: "ReviewItem",
      resourceId: "r1",
      metadata: { edited: true },
    });

    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].prevHash).toBeNull();
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[0].hash).not.toBe("pending");

    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("detects an altered entry", async () => {
    const target = await prisma.auditEvent.findFirstOrThrow({ orderBy: { seq: "asc" } });
    // Someone quietly rewrites who did it.
    await prisma.auditEvent.update({
      where: { id: target.id },
      data: { actorName: "someone-else" },
    });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(target.seq.toString());
    expect(result.reason).toContain("altered");

    await prisma.auditEvent.update({ where: { id: target.id }, data: { actorName: target.actorName } });
    expect((await verifyAuditChain()).valid).toBe(true);
  });

  it("detects a deleted entry", async () => {
    await recordAudit({ action: "ticket.status_change", actorName: "noura", propertyId: "p1" });
    const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" } });
    const middle = rows[1];

    // Deleting the middle entry orphans the one after it.
    await prisma.auditEvent.delete({ where: { id: middle.id } });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("removed or reordered");
  });

  it("survives concurrent writes without forking the chain", async () => {
    await prisma.auditEvent.deleteMany({});
    // The advisory lock is what makes this hold; without it, concurrent
    // writers read the same tail and produce duplicate prevHash values.
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        recordAudit({ action: "load.test", actorName: `actor-${i}`, propertyId: "p1" })
      )
    );

    const result = await verifyAuditChain();
    expect(result.checked).toBe(25);
    expect(result.valid).toBe(true);
  });
});
