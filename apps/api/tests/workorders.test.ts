import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { createWorkOrder, addUpdate, closeWorkOrder, ownWorkOrder } from "../src/modules/workorders/service.js";
import { can, normaliseRole } from "../src/modules/auth/permissions.js";

/**
 * §6-ج / §11-5 acceptance: critical work orders escalate on creation and
 * cannot be closed without maintenance-manager confirmation; technicians
 * see and touch only their own assignments; photo evidence must be the
 * property's own files.
 */
describe("work orders (§6-ج / §11-5)", () => {
  const stamp = Date.now();
  const propertyId = `wo-${stamp}`;
  const otherPropertyId = `wo-other-${stamp}`;
  let techId = "";
  let mgrId = "";

  const tech = () => ({ staffId: techId, name: "Tariq", role: "technician", propertyId });
  const mgr = () => ({ staffId: mgrId, name: "Mazen", role: "maintenance_manager", propertyId });

  beforeAll(async () => {
    await prisma.property.createMany({
      data: [
        { id: propertyId, name: "WO Hotel" },
        { id: otherPropertyId, name: "Other Hotel" },
      ],
    });
    const t = await prisma.staffMember.create({
      data: { propertyId, name: "Tariq", role: "technician", department: "maintenance" },
    });
    const m = await prisma.staffMember.create({
      data: { propertyId, name: "Mazen", role: "maintenance_manager", department: "maintenance" },
    });
    techId = t.id;
    mgrId = m.id;
  });

  it("policy: only maintenance managers and above close critical WOs", () => {
    expect(can("technician", "workorders.close")).toBe(true);
    expect(can("technician", "workorders.close_critical")).toBe(false);
    expect(can("maintenance_manager", "workorders.close_critical")).toBe(true);
    expect(can("hotel_manager", "workorders.close_critical")).toBe(true);
    expect(can("technician", "workorders.view_all")).toBe(false);
    expect(can("technician", "workorders.view_own")).toBe(true);
    expect(normaliseRole("technician")).toBe("technician");
  });

  it("critical creation emits the immediate escalation event (§6-ج)", async () => {
    const wo = await createWorkOrder({
      actor: mgr(),
      title: `تسريب مياه رئيسي ${stamp}`,
      category: "plumbing",
      priority: "critical",
      location: "غرفة 204",
      assigneeId: techId,
    });
    expect(wo.status).toBe("assigned");
    const alert = await prisma.altaEvent.findFirst({
      where: { propertyId, type: "workorder.critical" },
    });
    expect(alert).toBeTruthy();
  });

  it("technician cannot close a critical WO — it parks at awaiting_confirm", async () => {
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { propertyId, priority: "critical" } });
    // walk it into progress first (legal transition)
    const step = await addUpdate({ actor: tech(), workOrderId: wo.id, note: "بدأت الإصلاح", statusTo: "in_progress" });
    expect(step.ok).toBe(true);

    const attempt = await closeWorkOrder({
      actor: tech(),
      workOrderId: wo.id,
      canCloseCritical: can("technician", "workorders.close_critical"),
    });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.status).toBe(403);

    const parked = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(parked.status).toBe("awaiting_confirm");
  });

  it("maintenance manager confirms the critical close", async () => {
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { propertyId, priority: "critical" } });
    const result = await closeWorkOrder({
      actor: mgr(),
      workOrderId: wo.id,
      canCloseCritical: can("maintenance_manager", "workorders.close_critical"),
      note: "تم التحقق من الإصلاح",
    });
    expect(result.ok).toBe(true);
    const closed = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    expect(closed.status).toBe("closed");
    expect(closed.closedBy).toBe(mgrId);
  });

  it("technician cannot touch a WO assigned to someone else", async () => {
    const other = await createWorkOrder({
      actor: mgr(),
      title: `مكيف لا يعمل ${stamp}`,
      category: "hvac",
      priority: "normal",
      location: "غرفة 108",
      assigneeId: mgrId, // deliberately not the technician
    });
    const attempt = await addUpdate({ actor: tech(), workOrderId: other.id, note: "sneaky", statusTo: "in_progress" });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.status).toBe(403);
  });

  it("illegal status jumps are rejected", async () => {
    const wo = await createWorkOrder({
      actor: mgr(),
      title: `مصباح محترق ${stamp}`,
      category: "electrical",
      priority: "low",
      location: "الممر 3",
      assigneeId: techId,
    });
    const jump = await addUpdate({ actor: tech(), workOrderId: wo.id, note: "x", statusTo: "awaiting_confirm" });
    expect(jump.ok).toBe(false); // assigned → awaiting_confirm skips in_progress
    if (!jump.ok) expect(jump.status).toBe(422);
  });

  it("photo evidence must be the property's own active files", async () => {
    const foreign = await prisma.storageFile.create({
      data: {
        propertyId: otherPropertyId,
        kind: "fault_photo",
        path: `${otherPropertyId}/fault_photo/2026/08/foreign-${stamp}.jpg`,
        name: "foreign.jpg",
        mime: "image/jpeg",
        sizeBytes: 1000n,
        status: "active",
      },
    });
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { propertyId, assigneeId: techId, status: { not: "closed" } } });
    const attempt = await addUpdate({ actor: tech(), workOrderId: wo.id, note: "صورة", photoFileIds: [foreign.id] });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.status).toBe(422);

    const own = await prisma.storageFile.create({
      data: {
        propertyId,
        kind: "fault_photo",
        path: `${propertyId}/fault_photo/2026/08/own-${stamp}.jpg`,
        name: "own.jpg",
        mime: "image/jpeg",
        sizeBytes: 1000n,
        status: "active",
      },
    });
    const good = await addUpdate({ actor: tech(), workOrderId: wo.id, note: "قبل الإصلاح", photoFileIds: [own.id] });
    expect(good.ok).toBe(true);
  });

  it("cross-property WO access resolves to null (§11-1)", async () => {
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { propertyId } });
    expect(await ownWorkOrder(otherPropertyId, wo.id)).toBeNull();
    // and tenantId was derived by the DB trigger
    expect(wo.tenantId).toBe(`tnt-${propertyId}`);
  });
});
