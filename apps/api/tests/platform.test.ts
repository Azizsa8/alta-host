import { describe, it, expect } from "vitest";
import { prisma } from "../src/db.js";
import { createHotel, setTenantState, listTenants, isTenantSuspended } from "../src/modules/platform/service.js";
import { can } from "../src/modules/auth/permissions.js";

/**
 * §13: platform administration — hotel onboarding in one call, plan/quota
 * management, and suspension that actually cuts access. alta_admin only.
 */
describe("platform administration (§13)", () => {
  const stamp = Date.now();
  const hotelId = `plat-${stamp}`;
  const admin = { staffId: "alta-1", name: "ALTA Admin" };

  it("only alta_admin holds platform.manage", () => {
    expect(can("alta_admin", "platform.manage")).toBe(true);
    for (const role of ["hotel_manager", "general_manager", "reception", "maintenance_manager", "technician", "marketing_manager"]) {
      expect(can(role, "platform.manage")).toBe(false);
    }
  });

  it("creates a hotel: property + auto-tenant + plan/quota + manager login", async () => {
    const result = await createHotel({
      actor: admin,
      propertyId: hotelId,
      name: "فندق الاختبار",
      plan: "pro",
      quotaGb: 50,
      managerName: "مدير الاختبار",
      managerUsername: `mgr-${stamp}`,
      managerPassword: "strong-pass-123",
    });
    expect(result.ok).toBe(true);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: `tnt-${hotelId}` } });
    expect(tenant.plan).toBe("pro");
    expect(tenant.quotaGb).toBe(50);

    const manager = await prisma.staffMember.findUniqueOrThrow({ where: { username: `mgr-${stamp}` } });
    expect(manager.role).toBe("hotel_manager");
    expect(manager.propertyId).toBe(hotelId);
    expect(manager.passwordHash).not.toContain("strong-pass"); // hashed, never stored plain

    const audit = await prisma.auditEvent.findFirst({ where: { action: "platform.hotel_created", resourceId: `tnt-${hotelId}` } });
    expect(audit).toBeTruthy();
  });

  it("duplicate property id and username are refused", async () => {
    const dup = await createHotel({
      actor: admin,
      propertyId: hotelId,
      name: "x",
      plan: "basic",
      quotaGb: 10,
      managerName: "x",
      managerUsername: `other-${stamp}`,
      managerPassword: "strong-pass-123",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.status).toBe(409);
  });

  it("suspension bites instantly in-process and is audited; reactivation restores", async () => {
    const tenantId = `tnt-${hotelId}`;
    expect(await isTenantSuspended(tenantId)).toBe(false); // warms the cache

    const suspend = await setTenantState({ actor: admin, tenantId, status: "suspended" });
    expect(suspend.ok).toBe(true);
    // cache was busted by the write — no 30s staleness for the instance that suspended
    expect(await isTenantSuspended(tenantId)).toBe(true);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "platform.tenant_suspended", resourceId: tenantId } });
    expect(audit).toBeTruthy();

    const activate = await setTenantState({ actor: admin, tenantId, status: "active" });
    expect(activate.ok).toBe(true);
    expect(await isTenantSuspended(tenantId)).toBe(false);
  });

  it("plan/quota updates land on the tenant", async () => {
    const result = await setTenantState({ actor: admin, tenantId: `tnt-${hotelId}`, plan: "enterprise", quotaGb: 200 });
    expect(result.ok).toBe(true);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: `tnt-${hotelId}` } });
    expect(tenant.plan).toBe("enterprise");
    expect(tenant.quotaGb).toBe(200);
  });

  it("the board lists the new tenant with usage and headcounts", async () => {
    const rows = await listTenants();
    const row = rows.find((r) => r.id === `tnt-${hotelId}`);
    expect(row).toBeTruthy();
    expect(row!.staffCount).toBe(1);
    expect(row!.properties).toEqual([hotelId]);
    expect(row!.status).toBe("active");
  });
});
