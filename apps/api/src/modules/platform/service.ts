import bcrypt from "bcryptjs";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";

export const TENANT_PLANS = ["trial", "basic", "pro", "enterprise"] as const;

/**
 * §13 onboarding as one call instead of the runbook's SQL: create the
 * Property (its tenant auto-provisions via the DB trigger), set the plan
 * and quota, and create the hotel-manager login — everything a pilot
 * needs before its manager first signs in.
 */
export async function createHotel(params: {
  actor: { staffId: string; name: string };
  propertyId: string;
  name: string;
  plan: (typeof TENANT_PLANS)[number];
  quotaGb: number;
  managerName: string;
  managerUsername: string;
  managerPassword: string;
}): Promise<{ ok: true; propertyId: string } | { ok: false; status: number; error: string }> {
  if (await prisma.property.findUnique({ where: { id: params.propertyId } })) {
    return { ok: false, status: 409, error: "property id already exists" };
  }
  if (await prisma.staffMember.findUnique({ where: { username: params.managerUsername } })) {
    return { ok: false, status: 409, error: "username already taken" };
  }

  await prisma.property.create({ data: { id: params.propertyId, name: params.name } });
  await prisma.tenant.update({
    where: { id: `tnt-${params.propertyId}` },
    data: { name: params.name, plan: params.plan, quotaGb: params.quotaGb },
  });
  await prisma.staffMember.create({
    data: {
      propertyId: params.propertyId,
      name: params.managerName,
      role: "hotel_manager",
      username: params.managerUsername,
      passwordHash: bcrypt.hashSync(params.managerPassword, 10),
    },
  });

  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.propertyId,
    action: "platform.hotel_created",
    resourceType: "Tenant",
    resourceId: `tnt-${params.propertyId}`,
    outcome: "success",
    metadata: { plan: params.plan, quotaGb: params.quotaGb },
  });
  return { ok: true, propertyId: params.propertyId };
}

/**
 * Suspension gate. Cached 30s because it runs on EVERY authenticated
 * request — the same hot-path lesson as agent policies. A suspension
 * from another api instance bites within 30s; from this one, instantly
 * (setTenantState busts the cache).
 */
const statusCache = new Map<string, { suspended: boolean; at: number }>();

export async function isTenantSuspended(tenantId: string): Promise<boolean> {
  const hit = statusCache.get(tenantId);
  if (hit && Date.now() - hit.at < 30_000) return hit.suspended;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const suspended = tenant?.status === "suspended";
  statusCache.set(tenantId, { suspended, at: Date.now() });
  return suspended;
}

export async function setTenantState(params: {
  actor: { staffId: string; name: string };
  tenantId: string;
  plan?: (typeof TENANT_PLANS)[number];
  quotaGb?: number;
  status?: "active" | "suspended";
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } });
  if (!tenant) return { ok: false, status: 404, error: "tenant not found" };

  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: {
      ...(params.plan ? { plan: params.plan } : {}),
      ...(params.quotaGb !== undefined ? { quotaGb: params.quotaGb } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
  });
  statusCache.delete(params.tenantId);

  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    action:
      params.status === "suspended"
        ? "platform.tenant_suspended"
        : params.status === "active"
          ? "platform.tenant_activated"
          : "platform.tenant_updated",
    resourceType: "Tenant",
    resourceId: params.tenantId,
    outcome: "success",
    metadata: { plan: params.plan, quotaGb: params.quotaGb, status: params.status },
  });
  return { ok: true };
}

/** The platform board: every tenant with usage and headcounts. */
export async function listTenants() {
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: "asc" }, include: { properties: true } });
  const rows = [];
  for (const t of tenants) {
    const propertyIds = t.properties.map((p) => p.id);
    rows.push({
      id: t.id,
      name: t.name,
      plan: t.plan,
      status: t.status,
      quotaGb: t.quotaGb,
      usedBytes: t.usedBytes.toString(),
      usedPct: Math.round(Number((t.usedBytes * 100n) / (BigInt(t.quotaGb) * 1024n ** 3n))),
      properties: propertyIds,
      staffCount: await prisma.staffMember.count({ where: { propertyId: { in: propertyIds } } }),
      guestCount: await prisma.guest.count({ where: { propertyId: { in: propertyIds } } }),
      createdAt: t.createdAt.toISOString(),
    });
  }
  return rows;
}
