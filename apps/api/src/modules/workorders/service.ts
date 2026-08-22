import { prisma } from "../../db.js";
import { emitEvent } from "../events/bus.js";
import { recordAudit } from "../audit/service.js";

export const WO_CATEGORIES = ["electrical", "plumbing", "hvac", "furniture", "other"] as const;
export const WO_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export const WO_STATUSES = ["new", "assigned", "in_progress", "awaiting_confirm", "closed"] as const;

/** Legal transitions — a WO can't jump from new to closed without passing
 *  through work, and closing is its own gated call (closeWorkOrder), not a
 *  status update. */
const TRANSITIONS: Record<string, string[]> = {
  new: ["assigned", "in_progress"],
  assigned: ["in_progress", "new"],
  in_progress: ["awaiting_confirm", "assigned"],
  awaiting_confirm: ["in_progress"], // manager kicks it back
  closed: [],
};

type Actor = { staffId: string; name: string; role: string; propertyId: string };

export async function createWorkOrder(params: {
  actor: Actor;
  title: string;
  category: (typeof WO_CATEGORIES)[number];
  priority: (typeof WO_PRIORITIES)[number];
  location: string;
  ticketId?: string;
  assigneeId?: string;
  checklist?: Array<{ item: string; done: boolean }>;
}) {
  const wo = await prisma.workOrder.create({
    data: {
      propertyId: params.actor.propertyId,
      title: params.title,
      category: params.category,
      priority: params.priority,
      location: params.location,
      ticketId: params.ticketId,
      assigneeId: params.assigneeId,
      status: params.assigneeId ? "assigned" : "new",
      checklist: params.checklist ?? [],
      createdBy: params.actor.staffId,
    },
  });

  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "workorder.create",
    resourceType: "WorkOrder",
    resourceId: wo.id,
    outcome: "success",
    metadata: { priority: wo.priority, category: wo.category },
  });

  await emitEvent(wo.propertyId, {
    type: "workorder.created",
    workOrderId: wo.id,
    title: wo.title,
    priority: wo.priority,
    location: wo.location,
  });

  // §6-ج: a critical fault escalates immediately — the maintenance manager
  // and the escalation list must hear about it the moment it exists, not
  // when someone opens the board.
  if (wo.priority === "critical") {
    await emitEvent(wo.propertyId, {
      type: "workorder.critical",
      workOrderId: wo.id,
      title: wo.title,
      location: wo.location,
    });
  }

  return wo;
}

/** Loads a WO and proves it belongs to the actor's property (§11-1). */
export async function ownWorkOrder(propertyId: string, id: string) {
  const wo = await prisma.workOrder.findUnique({ where: { id }, include: { updates: { orderBy: { createdAt: "asc" } } } });
  if (!wo || wo.propertyId !== propertyId) return null;
  return wo;
}

export async function assignWorkOrder(params: { actor: Actor; workOrderId: string; assigneeId: string }) {
  const wo = await ownWorkOrder(params.actor.propertyId, params.workOrderId);
  if (!wo || wo.status === "closed") return null;

  const updated = await prisma.workOrder.update({
    where: { id: wo.id },
    data: { assigneeId: params.assigneeId, status: wo.status === "new" ? "assigned" : wo.status },
  });
  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "workorder.assign",
    resourceType: "WorkOrder",
    resourceId: wo.id,
    outcome: "success",
    metadata: { assigneeId: params.assigneeId },
  });
  await emitEvent(wo.propertyId, { type: "workorder.updated", workOrderId: wo.id, status: updated.status });
  return updated;
}

export async function addUpdate(params: {
  actor: Actor;
  workOrderId: string;
  note: string;
  photoFileIds?: string[];
  statusTo?: string;
}): Promise<{ ok: true; update: unknown } | { ok: false; status: number; error: string }> {
  const wo = await ownWorkOrder(params.actor.propertyId, params.workOrderId);
  if (!wo) return { ok: false, status: 404, error: "work order not found" };
  if (wo.status === "closed") return { ok: false, status: 409, error: "work order is closed" };

  // Technicians only touch their own assignments (§4).
  if (params.actor.role === "technician" && wo.assigneeId !== params.actor.staffId) {
    return { ok: false, status: 403, error: "not your work order" };
  }

  if (params.statusTo) {
    if (!TRANSITIONS[wo.status]?.includes(params.statusTo)) {
      return { ok: false, status: 422, error: `cannot move ${wo.status} → ${params.statusTo}` };
    }
  }

  // Photo ids must be this property's own active files — a foreign id
  // would let an update reference another tenant's evidence.
  const photoIds = params.photoFileIds ?? [];
  if (photoIds.length > 0) {
    const owned = await prisma.storageFile.count({
      where: { id: { in: photoIds }, propertyId: params.actor.propertyId, status: "active" },
    });
    if (owned !== photoIds.length) return { ok: false, status: 422, error: "unknown photo file id" };
  }

  const [update] = await prisma.$transaction([
    prisma.workOrderUpdate.create({
      data: {
        workOrderId: wo.id,
        authorId: params.actor.staffId,
        authorName: params.actor.name,
        note: params.note,
        photoFileIds: photoIds,
        statusTo: params.statusTo,
      },
    }),
    ...(params.statusTo
      ? [prisma.workOrder.update({ where: { id: wo.id }, data: { status: params.statusTo } })]
      : []),
  ]);

  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "workorder.update",
    resourceType: "WorkOrder",
    resourceId: wo.id,
    outcome: "success",
    metadata: { statusTo: params.statusTo ?? null, photos: photoIds.length },
  });
  await emitEvent(wo.propertyId, {
    type: "workorder.updated",
    workOrderId: wo.id,
    status: params.statusTo ?? wo.status,
  });
  return { ok: true, update };
}

/** §6-ج: closing a critical WO requires maintenance-manager (or above)
 *  confirmation — enforced HERE, in the service, so no route wiring
 *  mistake can bypass it. `canCloseCritical` is decided by the caller's
 *  policy check and passed in explicitly. */
export async function closeWorkOrder(params: {
  actor: Actor;
  workOrderId: string;
  canCloseCritical: boolean;
  note?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const wo = await ownWorkOrder(params.actor.propertyId, params.workOrderId);
  if (!wo) return { ok: false, status: 404, error: "work order not found" };
  if (wo.status === "closed") return { ok: false, status: 409, error: "already closed" };

  if (params.actor.role === "technician" && wo.assigneeId !== params.actor.staffId) {
    return { ok: false, status: 403, error: "not your work order" };
  }

  if (wo.priority === "critical" && !params.canCloseCritical) {
    // The technician's path for critical faults: hand it to the manager.
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "awaiting_confirm" } });
    await emitEvent(wo.propertyId, { type: "workorder.updated", workOrderId: wo.id, status: "awaiting_confirm" });
    return { ok: false, status: 403, error: "critical close requires maintenance manager confirmation" };
  }

  await prisma.$transaction([
    prisma.workOrder.update({
      where: { id: wo.id },
      data: { status: "closed", closedBy: params.actor.staffId, closedAt: new Date() },
    }),
    prisma.workOrderUpdate.create({
      data: {
        workOrderId: wo.id,
        authorId: params.actor.staffId,
        authorName: params.actor.name,
        note: params.note ?? "أُغلق أمر العمل",
        statusTo: "closed",
      },
    }),
  ]);

  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "workorder.close",
    resourceType: "WorkOrder",
    resourceId: wo.id,
    outcome: "success",
    metadata: { priority: wo.priority },
  });
  await emitEvent(wo.propertyId, { type: "workorder.closed", workOrderId: wo.id, priority: wo.priority });
  return { ok: true };
}
