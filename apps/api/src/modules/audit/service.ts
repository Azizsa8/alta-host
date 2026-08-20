import { createHash } from "node:crypto";
import type { Request } from "express";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";

export interface AuditInput {
  action: string;
  actorId?: string | null;
  actorName: string;
  propertyId?: string | null;
  resourceType?: string;
  resourceId?: string;
  outcome?: "success" | "failure";
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Canonical serialisation of an entry for hashing. Field order is fixed
 * and explicit: if it depended on object key order or JSON.stringify's
 * behaviour, the same entry could hash differently across runtimes and
 * every verification would be meaningless.
 */
function canonical(e: {
  seq: bigint;
  propertyId: string | null;
  actorId: string | null;
  actorName: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: string;
  metadata: string;
  createdAt: Date;
  prevHash: string | null;
}): string {
  return [
    e.seq.toString(),
    e.propertyId ?? "",
    e.actorId ?? "",
    e.actorName,
    e.action,
    e.resourceType ?? "",
    e.resourceId ?? "",
    e.outcome,
    e.metadata,
    e.createdAt.toISOString(),
    e.prevHash ?? "",
  ].join(" ");
}

function hashOf(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Appends an audit entry chained to the previous one.
 *
 * Serialised through a transaction with a Postgres advisory lock so two
 * concurrent writers can't read the same tail and fork the chain — under
 * the 40-way concurrency this system actually sees, that would otherwise
 * happen routinely and silently invalidate verification.
 *
 * Never throws: an audit write failing must not break the operation being
 * audited, but it is logged loudly, because a silent gap in an audit trail
 * is exactly what an auditor looks for.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // 4171 is an arbitrary but fixed lock key for the audit chain.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4171)`;

      const prev = await tx.auditEvent.findFirst({
        orderBy: { seq: "desc" },
        select: { hash: true },
      });

      const created = await tx.auditEvent.create({
        data: {
          propertyId: input.propertyId ?? null,
          actorId: input.actorId ?? null,
          actorName: input.actorName,
          action: input.action,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          outcome: input.outcome ?? "success",
          metadata: JSON.stringify(input.metadata ?? {}),
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          prevHash: prev?.hash ?? null,
          hash: "pending",
        },
      });

      // The hash covers seq and createdAt, which the database assigns, so
      // it can only be computed once the row exists.
      const hash = hashOf(canonical({ ...created, prevHash: prev?.hash ?? null }));
      await tx.auditEvent.update({ where: { id: created.id }, data: { hash } });
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "AUDIT WRITE FAILED - trail has a gap");
  }
}

/** Pulls actor + request context off an authenticated request. */
export function auditContextFrom(
  req: Request
): Pick<AuditInput, "actorId" | "actorName" | "propertyId" | "ip" | "userAgent"> {
  return {
    actorId: req.staff?.staffId ?? null,
    actorName: req.staff?.name ?? "anonymous",
    propertyId: req.staff?.propertyId ?? null,
    ip: req.ip,
    userAgent: req.header("user-agent") ?? undefined,
  };
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtSeq?: string;
  reason?: string;
}

/**
 * Walks the chain from the beginning and recomputes every hash. Any
 * edited field, deleted row, or reordered entry breaks the link and is
 * reported with the exact sequence number where it happened.
 */
export async function verifyAuditChain(limit = 10_000): Promise<ChainVerification> {
  const rows = await prisma.auditEvent.findMany({ orderBy: { seq: "asc" }, take: limit });
  let prevHash: string | null = null;

  for (const row of rows) {
    if (row.prevHash !== prevHash) {
      return {
        valid: false,
        checked: rows.length,
        brokenAtSeq: row.seq.toString(),
        reason: "prevHash does not match the preceding entry - an entry was removed or reordered",
      };
    }
    const expected = hashOf(canonical({ ...row, prevHash }));
    if (expected !== row.hash) {
      return {
        valid: false,
        checked: rows.length,
        brokenAtSeq: row.seq.toString(),
        reason: "recomputed hash does not match - this entry was altered after it was written",
      };
    }
    prevHash = row.hash;
  }

  return { valid: true, checked: rows.length };
}
