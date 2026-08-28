import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { handleInbound } from "../whatsapp/webhook.js";
import { listPendingReviews } from "../reviews/reviewService.js";
import { approveReview, rejectReview } from "../reviews/reviewOrchestrator.js";
import { generateDailyReport } from "../reports/dailyReport.js";
import { applyPendingEscalations } from "../tickets/ticketService.js";
import { requireAuth } from "../auth/middleware.js";
import { AGENT_REGISTRY } from "../agents/registry.js";
import { can } from "../auth/permissions.js";
import { quotaFor, requestUpload, confirmUpload, signedDownloadUrl, trashFile, restoreFile, FILE_KINDS } from "../storage/service.js";
import {
  createWorkOrder,
  ownWorkOrder,
  assignWorkOrder,
  addUpdate as addWorkOrderUpdate,
  closeWorkOrder,
  WO_CATEGORIES,
  WO_PRIORITIES,
} from "../workorders/service.js";
import { setAgentEnabled } from "../knowledge/service.js";
import { syncReviews, approveAndPublish } from "../reputation/service.js";
import { createHotel, setTenantState, listTenants, isTenantSuspended, TENANT_PLANS } from "../platform/service.js";
import {
  listChannels,
  updateChannel,
  generateForChannel,
  channelCalendar,
  channelAnalytics,
} from "../social/service.js";
import { CHANNEL_KEYS } from "../social/catalogue.js";
import { startConnect, saveChannelCredentials, completeOauth, disconnectChannel } from "../social/connect.js";
import {
  captureComplaint,
  ownCase,
  recordRca,
  updateCase,
  complaintPatterns,
  CASE_STATUSES,
} from "../complaints/service.js";
import {
  generateIdeas,
  draftFromIdea,
  transitionContent,
  publishContent,
  CONTENT_CHANNELS,
} from "../content/service.js";
import { recordAudit, auditContextFrom, verifyAuditChain } from "../audit/service.js";
import { emitEvent } from "../events/bus.js";
import { sendWhatsAppMessage } from "../whatsapp/gateway.js";
import { listCredentials, setCredential, deleteCredential, CREDENTIAL_KEYS } from "../credentials/service.js";

export const apiRouter = Router();
// Everything in this router is dashboard/staff-facing — /auth/login and
// /auth/me are mounted separately in server.ts, before this middleware.
apiRouter.use(requireAuth);

// §13: a suspended hotel's staff lose API access entirely (alta_admin is
// exempt — someone has to be able to un-suspend). Cached 30s in the
// service; suspension from this instance bites instantly.
apiRouter.use((req, res, next) => {
  if (req.staff!.role === "alta_admin") {
    next();
    return;
  }
  isTenantSuspended(req.staff!.tenantId)
    .then((suspended) => {
      if (suspended) res.status(403).json({ error: "الاشتراك موقوف — تواصل مع إدارة منصة ألتا" });
      else next();
    })
    .catch(next);
});

// Shared error shape for every route in this file: Zod validation failures
// become a 400 with a readable message, anything else is treated as a
// genuinely unexpected error and returned as a 500 — never Express's default
// HTML/error format.
function sendError(res: Response, err: unknown) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: err.issues.map((issue) => issue.message).join("; ") || "invalid request" });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "unexpected error" });
}

// Wraps a route handler so any thrown/rejected error (Zod validation errors
// included) is funneled through sendError instead of crashing the request
// or falling through to Express's default error format.
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      sendError(res, err);
    }
  };
}


/**
 * The §11-1 gate for list endpoints. Callers may pass ?propertyId= (the
 * dashboard always does), but the value is only honoured when it matches
 * the authenticated staff's own property — anything else is a cross-tenant
 * probe and gets a 403 rather than someone else's data. Before this,
 * these endpoints trusted the query param outright, which let any staff
 * token read any property's tickets/guests/reviews by changing one id.
 */
function scopedPropertyId(req: Request, res: Response, requested?: string): string | null {
  const own = req.staff!.propertyId;
  if (requested && requested !== own) {
    res.status(403).json({ error: "propertyId does not belong to your account" });
    return null;
  }
  return own;
}

// Optional propertyId query param, used by list/metrics endpoints that can
// be scoped to a single property or return everything when omitted.
const PropertyIdQuery = z.object({
  propertyId: z.string().min(1).optional(),
});

// Required propertyId query param, used by endpoints that only make sense
// for a single property.
const RequiredPropertyIdQuery = z.object({
  propertyId: z.string().min(1, "propertyId is required"),
});

// Route :id params — all ids in this schema are DB-generated UUIDs, so a
// malformed id (empty, garbage string, wrong shape) is rejected here before
// it ever reaches Prisma and produces a less clean error.
const IdParam = z.object({
  id: z.string().uuid("id must be a valid id"),
});

// Stands in for a real WhatsApp message in local/demo use — the dashboard's
// Simulator panel posts here so the whole pipeline can be exercised without
// WhatsApp Business API credentials.
const SimulatePayload = z.object({
  propertyId: z.string(),
  from: z.string(),
  text: z.string(),
  guestName: z.string().optional(),
});

apiRouter.post(
  "/simulate",
  asyncRoute(async (req, res) => {
    const payload = SimulatePayload.parse(req.body);
    if (!scopedPropertyId(req, res, payload.propertyId)) return;
    const result = await handleInbound(payload);
    res.json(result);
  })
);

apiRouter.get(
  "/properties",
  asyncRoute(async (_req, res) => {
    const properties = await prisma.property.findMany();
    res.json(properties);
  })
);

// The agent fleet's declarative configuration — what the Operations
// Center renders as "every agent, its role, tools, and review policy".
apiRouter.get("/agents", (_req, res) => {
  res.json(AGENT_REGISTRY);
});

// The audit trail, newest first, scoped to the caller's property.
// Filterable by action and actor because "show me everything this staff
// member approved last month" is the actual question asked in a review.
apiRouter.get(
  "/audit",
  asyncRoute(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const actorId = typeof req.query.actorId === "string" ? req.query.actorId : undefined;

    const rows = await prisma.auditEvent.findMany({
      where: {
        propertyId: req.staff!.propertyId,
        ...(action ? { action } : {}),
        ...(actorId ? { actorId } : {}),
      },
      orderBy: { seq: "desc" },
      take: limit,
    });

    res.json(
      rows.map((r) => ({
        seq: r.seq.toString(),
        actorName: r.actorName,
        actorId: r.actorId,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        outcome: r.outcome,
        metadata: JSON.parse(r.metadata),
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
        hash: r.hash,
      }))
    );
  })
);

// Recomputes the whole chain. This is the endpoint to demonstrate in a
// security review: it proves the trail has not been edited, rather than
// asking anyone to take that on trust.
apiRouter.get(
  "/audit/verify",
  asyncRoute(async (_req, res) => {
    res.json(await verifyAuditChain());
  })
);

// ---- credential vault -------------------------------------------------
// Lists which credentials this property has configured. Deliberately
// never returns a value: there is no read-back endpoint at all, because
// an API that can return a secret is an API that can leak one.
apiRouter.get(
  "/credentials",
  asyncRoute(async (req, res) => {
    // Even the metadata (which keys exist, when rotated) is manager-only
    // (§8) — knowing WHICH integrations a hotel runs is reconnaissance.
    if (!can(req.staff!.role, "credentials.manage")) {
      res.status(403).json({ error: "only the hotel manager can manage credentials" });
      return;
    }
    res.json(await listCredentials(req.staff!.propertyId));
  })
);

const CredentialPayload = z.object({
  key: z.enum(CREDENTIAL_KEYS),
  value: z.string().min(1),
});

// Stores or rotates a credential. Managers only — a receptionist has no
// business holding the property's PMS tokens.
apiRouter.put(
  "/credentials",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "credentials.manage")) {
      res.status(403).json({ error: "only the hotel manager can manage credentials" });
      return;
    }
    const payload = CredentialPayload.parse(req.body);
    await setCredential({
      propertyId: req.staff!.propertyId,
      key: payload.key,
      value: payload.value,
      actor: auditContextFrom(req),
    });
    res.status(204).end();
  })
);

apiRouter.delete(
  "/credentials/:key",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "credentials.manage")) {
      res.status(403).json({ error: "only the hotel manager can manage credentials" });
      return;
    }
    const removed = await deleteCredential({
      propertyId: req.staff!.propertyId,
      key: req.params.key,
      actor: auditContextFrom(req),
    });
    res.status(removed ? 204 : 404).end();
  })
);

// Latest domain events for the ops feed's initial paint — the live tail
// arrives over /api/events/stream (SSE) afterwards.
apiRouter.get(
  "/events/recent",
  asyncRoute(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const rows = await prisma.altaEvent.findMany({
      where: { propertyId: req.staff!.propertyId },
      orderBy: { seq: "desc" },
      take: limit,
    });
    res.json(
      rows.reverse().map((row) => ({
        seq: row.seq.toString(),
        propertyId: row.propertyId,
        type: row.type,
        payload: JSON.parse(row.payload),
        createdAt: row.createdAt.toISOString(),
      }))
    );
  })
);



// ---- storage (§5 / §11-8) ---------------------------------------------

apiRouter.get(
  "/storage/quota",
  asyncRoute(async (req, res) => {
    const q = await quotaFor(req.staff!.propertyId);
    res.json({ quotaGb: q.quotaGb, usedBytes: q.usedBytes.toString(), usedPct: q.usedPct });
  })
);

const UploadRequest = z.object({
  kind: z.enum(FILE_KINDS),
  name: z.string().min(1).max(120),
  mime: z.string().min(3),
  sizeBytes: z.number().int().positive(),
});

// Two-step upload: this mints a short-lived presigned PUT after quota is
// reserved transactionally; the browser uploads straight to object
// storage (bytes never pass through the API), then confirms.
apiRouter.post(
  "/storage/uploads",
  asyncRoute(async (req, res) => {
    const payload = UploadRequest.parse(req.body);
    const result = await requestUpload({
      propertyId: req.staff!.propertyId,
      ownerId: req.staff!.staffId,
      ...payload,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json(result);
  })
);

apiRouter.post(
  "/storage/uploads/:id/confirm",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const ok = await confirmUpload(req.staff!.propertyId, id);
    res.status(ok ? 200 : 404).json({ confirmed: ok });
  })
);

apiRouter.get(
  "/storage/files",
  asyncRoute(async (req, res) => {
    const status = req.query.status === "trashed" ? "trashed" : "active";
    const files = await prisma.storageFile.findMany({
      where: { propertyId: req.staff!.propertyId, status },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(
      files.map((f) => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        mime: f.mime,
        sizeBytes: f.sizeBytes.toString(),
        status: f.status,
        createdAt: f.createdAt.toISOString(),
      }))
    );
  })
);

// The only read path: a short-lived signed URL. Files are never public.
apiRouter.get(
  "/storage/files/:id/url",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const url = await signedDownloadUrl(req.staff!.propertyId, id);
    if (!url) {
      res.status(404).json({ error: "file not found" });
      return;
    }
    res.json({ url });
  })
);

apiRouter.delete(
  "/storage/files/:id",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const ok = await trashFile({
      propertyId: req.staff!.propertyId,
      fileId: id,
      actorName: req.staff!.name,
      actorId: req.staff!.staffId,
    });
    res.status(ok ? 204 : 404).end();
  })
);

apiRouter.post(
  "/storage/files/:id/restore",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const ok = await restoreFile(req.staff!.propertyId, id);
    res.status(ok ? 200 : 404).json({ restored: ok });
  })
);

// ---- work orders (§6-ج / §11-5) ---------------------------------------

function woActor(req: Request) {
  return {
    staffId: req.staff!.staffId,
    name: req.staff!.name,
    role: req.staff!.role,
    propertyId: req.staff!.propertyId,
  };
}

// Technicians get ONLY their own assignments (§4); board roles see all.
apiRouter.get(
  "/workorders",
  asyncRoute(async (req, res) => {
    const role = req.staff!.role;
    let where: Record<string, unknown>;
    if (can(role, "workorders.view_all")) {
      where = { propertyId: req.staff!.propertyId };
    } else if (can(role, "workorders.view_own")) {
      where = { propertyId: req.staff!.propertyId, assigneeId: req.staff!.staffId };
    } else {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status) where.status = status;
    const orders = await prisma.workOrder.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { updates: { orderBy: { createdAt: "asc" } } },
    });
    const staffIds = [...new Set(orders.flatMap((w) => [w.assigneeId, w.createdBy]).filter(Boolean))] as string[];
    const staff = await prisma.staffMember.findMany({ where: { id: { in: staffIds } } });
    const names = Object.fromEntries(staff.map((s) => [s.id, s.name]));
    res.json(
      orders.map((w) => ({
        ...w,
        assigneeName: w.assigneeId ? (names[w.assigneeId] ?? null) : null,
        createdByName: names[w.createdBy] ?? null,
      }))
    );
  })
);

const CreateWorkOrder = z.object({
  title: z.string().min(2).max(200),
  category: z.enum(WO_CATEGORIES),
  priority: z.enum(WO_PRIORITIES),
  location: z.string().min(1).max(120),
  ticketId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  checklist: z.array(z.object({ item: z.string().min(1), done: z.boolean() })).max(30).optional(),
});

apiRouter.post(
  "/workorders",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "workorders.create")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const payload = CreateWorkOrder.parse(req.body);
    const wo = await createWorkOrder({ actor: woActor(req), ...payload });
    res.status(201).json(wo);
  })
);

apiRouter.get(
  "/workorders/:id",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const wo = await ownWorkOrder(req.staff!.propertyId, id);
    if (!wo) {
      res.status(404).json({ error: "work order not found" });
      return;
    }
    if (can(req.staff!.role, "workorders.view_own") && wo.assigneeId !== req.staff!.staffId) {
      res.status(403).json({ error: "not your work order" });
      return;
    }
    res.json(wo);
  })
);

apiRouter.post(
  "/workorders/:id/assign",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "workorders.assign")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const { assigneeId } = z.object({ assigneeId: z.string().uuid() }).parse(req.body);
    const assignee = await prisma.staffMember.findFirst({
      where: { id: assigneeId, propertyId: req.staff!.propertyId },
    });
    if (!assignee) {
      res.status(422).json({ error: "assignee not in this property" });
      return;
    }
    const wo = await assignWorkOrder({ actor: woActor(req), workOrderId: id, assigneeId });
    if (!wo) {
      res.status(404).json({ error: "work order not found or closed" });
      return;
    }
    res.json(wo);
  })
);

const WoUpdate = z.object({
  note: z.string().min(1).max(2000),
  photoFileIds: z.array(z.string().uuid()).max(10).optional(),
  statusTo: z.enum(["assigned", "in_progress", "awaiting_confirm", "new"]).optional(),
});

apiRouter.post(
  "/workorders/:id/updates",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "workorders.update_status")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const payload = WoUpdate.parse(req.body);
    const result = await addWorkOrderUpdate({ actor: woActor(req), workOrderId: id, ...payload });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json(result.update);
  })
);

// Closing is its own call, not a status update — the §6-ج critical gate
// lives in the service and cannot be reached through /updates.
apiRouter.post(
  "/workorders/:id/close",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "workorders.close")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const note = typeof req.body?.note === "string" ? req.body.note : undefined;
    const result = await closeWorkOrder({
      actor: woActor(req),
      workOrderId: id,
      canCloseCritical: can(req.staff!.role, "workorders.close_critical"),
      note,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ closed: true });
  })
);

// Assign dropdown data: own-property staff only, names and roles — no
// contact details or credentials.
apiRouter.get(
  "/staff",
  asyncRoute(async (req, res) => {
    const staff = await prisma.staffMember.findMany({
      where: { propertyId: req.staff!.propertyId },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    res.json(staff);
  })
);

// ---- knowledge base + agent policies (§6-أ / §4 مركز الوكلاء) ----------

apiRouter.get(
  "/knowledge",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "knowledge.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const items = await prisma.knowledgeItem.findMany({
      where: { propertyId: req.staff!.propertyId },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    res.json(items);
  })
);

const KnowledgeBody = z.object({
  title: z.string().min(2).max(200),
  contentAr: z.string().min(2).max(4000),
  contentEn: z.string().max(4000).optional(),
  tags: z.array(z.string().min(2).max(40)).max(20).optional(),
});

apiRouter.post(
  "/knowledge",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "knowledge.manage")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const body = KnowledgeBody.parse(req.body);
    const item = await prisma.knowledgeItem.create({
      data: {
        propertyId: req.staff!.propertyId,
        title: body.title,
        contentAr: body.contentAr,
        contentEn: body.contentEn ?? "",
        tags: body.tags ?? [],
      },
    });
    res.status(201).json(item);
  })
);

// Status is its own endpoint: approval is the act agents trust (§6-أ),
// so it is explicit, audited, and never a side effect of an edit.
apiRouter.post(
  "/knowledge/:id/status",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "knowledge.manage")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const { status } = z.object({ status: z.enum(["draft", "approved", "retired"]) }).parse(req.body);
    const existing = await prisma.knowledgeItem.findUnique({ where: { id } });
    if (!existing || existing.propertyId !== req.staff!.propertyId) {
      res.status(404).json({ error: "knowledge item not found" });
      return;
    }
    const item = await prisma.knowledgeItem.update({
      where: { id },
      data: { status, approvedBy: status === "approved" ? req.staff!.staffId : existing.approvedBy },
    });
    await recordAudit({
      actorName: req.staff!.name,
      actorId: req.staff!.staffId,
      propertyId: req.staff!.propertyId,
      action: `knowledge.${status}`,
      resourceType: "KnowledgeItem",
      resourceId: id,
      outcome: "success",
      metadata: { title: existing.title },
    });
    res.json(item);
  })
);

apiRouter.get(
  "/agent-policies",
  asyncRoute(async (req, res) => {
    const policies = await prisma.agentPolicy.findMany({ where: { propertyId: req.staff!.propertyId } });
    res.json(policies);
  })
);

apiRouter.patch(
  "/agent-policies/:agentKey",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "agents.toggle")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { agentKey } = z.object({ agentKey: z.string().min(2).max(60) }).parse(req.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const policy = await setAgentEnabled({
      propertyId: req.staff!.propertyId,
      agentKey,
      enabled,
      updatedBy: req.staff!.staffId,
    });
    await recordAudit({
      actorName: req.staff!.name,
      actorId: req.staff!.staffId,
      propertyId: req.staff!.propertyId,
      action: enabled ? "agent.enable" : "agent.disable",
      resourceType: "AgentPolicy",
      resourceId: agentKey,
      outcome: "success",
    });
    res.json(policy);
  })
);

apiRouter.get(
  "/agent-runs",
  asyncRoute(async (req, res) => {
    const agentKey = typeof req.query.agentKey === "string" ? req.query.agentKey : undefined;
    const runs = await prisma.agentRun.findMany({
      where: { propertyId: req.staff!.propertyId, ...(agentKey ? { agentKey } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(runs);
  })
);

// ---- reputation: Google reviews (§6-د / §11-6) --------------------------

// Link the property's Google account. mock: refs need no token; real refs
// store the OAuth refresh token in the vault (§8) — it never lands in
// SocialAccount and is never echoed back.
apiRouter.post(
  "/reputation/link",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "reputation.link")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const body = z
      .object({
        accountRef: z.string().min(3).max(200),
        oauthRefreshToken: z.string().min(10).max(4000).optional(),
      })
      .parse(req.body);
    if (!body.accountRef.startsWith("mock:") && !body.oauthRefreshToken) {
      res.status(422).json({ error: "real accounts require oauthRefreshToken" });
      return;
    }
    if (body.oauthRefreshToken) {
      await setCredential({
        propertyId: req.staff!.propertyId,
        key: "google.oauthRefreshToken",
        value: body.oauthRefreshToken,
        actor: { actorName: req.staff!.name, actorId: req.staff!.staffId, ip: req.ip },
      });
    }
    const account = await prisma.socialAccount.upsert({
      where: { propertyId_platform: { propertyId: req.staff!.propertyId, platform: "google" } },
      create: { propertyId: req.staff!.propertyId, platform: "google", accountRef: body.accountRef },
      update: { accountRef: body.accountRef, status: "linked" },
    });
    await recordAudit({
      actorName: req.staff!.name,
      actorId: req.staff!.staffId,
      propertyId: req.staff!.propertyId,
      action: "reputation.link",
      resourceType: "SocialAccount",
      resourceId: account.id,
      outcome: "success",
      metadata: { accountRef: body.accountRef },
    });
    res.json({ linked: true, accountRef: account.accountRef });
  })
);

apiRouter.post(
  "/reputation/sync",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "reputation.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json(await syncReviews(req.staff!.propertyId));
  })
);

apiRouter.get(
  "/reputation/reviews",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "reputation.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const reviews = await prisma.googleReview.findMany({
      where: { propertyId: req.staff!.propertyId },
      orderBy: { reviewedAt: "desc" },
      take: 100,
    });
    const account = await prisma.socialAccount.findUnique({
      where: { propertyId_platform: { propertyId: req.staff!.propertyId, platform: "google" } },
    });
    const avg = reviews.length > 0 ? reviews.reduce((a, r) => a + r.stars, 0) / reviews.length : 0;
    res.json({ linked: !!account, accountRef: account?.accountRef ?? null, average: Math.round(avg * 10) / 10, reviews });
  })
);

// §7: no auto-publish — this human approval is the ONLY path to published.
apiRouter.post(
  "/reputation/reviews/:id/approve",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "reputation.reply")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const { editedReply } = z.object({ editedReply: z.string().max(2000).optional() }).parse(req.body ?? {});
    const result = await approveAndPublish({
      propertyId: req.staff!.propertyId,
      reviewId: id,
      actorId: req.staff!.staffId,
      actorName: req.staff!.name,
      editedReply,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ published: true });
  })
);

// ---- content studio (§6-هـ / §11-7) ------------------------------------

apiRouter.get(
  "/content/brand",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "content.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const profile = await prisma.brandProfile.findUnique({ where: { propertyId: req.staff!.propertyId } });
    res.json(profile ?? { identity: "", services: [], offers: [], audience: "", tone: "ودّي واحترافي", language: "ar" });
  })
);

const BrandBody = z.object({
  identity: z.string().max(500).optional(),
  services: z.array(z.string().min(1).max(80)).max(20).optional(),
  offers: z.array(z.string().min(1).max(120)).max(20).optional(),
  audience: z.string().max(300).optional(),
  tone: z.string().max(80).optional(),
  language: z.enum(["ar", "en", "both"]).optional(),
});

apiRouter.put(
  "/content/brand",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "content.edit")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const body = BrandBody.parse(req.body);
    const profile = await prisma.brandProfile.upsert({
      where: { propertyId: req.staff!.propertyId },
      create: { propertyId: req.staff!.propertyId, ...body },
      update: body,
    });
    res.json(profile);
  })
);

apiRouter.post(
  "/content/ideas",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "content.edit")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json({ ideas: await generateIdeas(req.staff!.propertyId) });
  })
);

apiRouter.get(
  "/content",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "content.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const items = await prisma.contentItem.findMany({
      where: { propertyId: req.staff!.propertyId },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    res.json(items);
  })
);

const ContentCreate = z.object({
  idea: z.string().min(3).max(300),
  channel: z.enum(CONTENT_CHANNELS),
  mediaFileIds: z.array(z.string().uuid()).max(10).optional(),
});

apiRouter.post(
  "/content",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "content.edit")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const body = ContentCreate.parse(req.body);
    const drafts = await draftFromIdea(req.staff!.propertyId, body.idea);
    const item = await prisma.contentItem.create({
      data: {
        propertyId: req.staff!.propertyId,
        idea: body.idea,
        channel: body.channel,
        mediaFileIds: body.mediaFileIds ?? [],
        bodyAr: drafts.bodyAr,
        bodyEn: drafts.bodyEn,
        status: "draft",
      },
    });
    res.status(201).json(item);
  })
);

const ContentEdit = z.object({
  bodyAr: z.string().max(4000).optional(),
  bodyEn: z.string().max(4000).optional(),
  mediaFileIds: z.array(z.string().uuid()).max(10).optional(),
});

apiRouter.patch(
  "/content/:id",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "content.edit")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const body = ContentEdit.parse(req.body);
    const existing = await prisma.contentItem.findUnique({ where: { id } });
    if (!existing || existing.propertyId !== req.staff!.propertyId) {
      res.status(404).json({ error: "content not found" });
      return;
    }
    if (existing.status === "published") {
      res.status(409).json({ error: "published content is immutable" });
      return;
    }
    const item = await prisma.contentItem.update({ where: { id }, data: body });
    res.json(item);
  })
);

const ContentTransition = z.object({
  to: z.enum(["draft", "in_review", "approved", "rejected", "scheduled", "failed"]),
  scheduledAt: z.coerce.date().optional(),
});

apiRouter.post(
  "/content/:id/transition",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const body = ContentTransition.parse(req.body);
    // approval/rejection is its own permission (§7); other moves are edit-level
    const needed = body.to === "approved" || body.to === "rejected" ? "content.approve" : "content.edit";
    if (!can(req.staff!.role, needed)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const result = await transitionContent({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name, propertyId: req.staff!.propertyId },
      contentId: id,
      to: body.to,
      scheduledAt: body.scheduledAt,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.item);
  })
);

apiRouter.post(
  "/content/:id/publish",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "content.approve")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const result = await publishContent({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name, propertyId: req.staff!.propertyId },
      contentId: id,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ published: true, resultUrl: result.resultUrl });
  })
);

// ---- platform administration (§13) — alta_admin only, cross-tenant ----

function requirePlatform(req: Request, res: Response): boolean {
  if (!can(req.staff!.role, "platform.manage")) {
    res.status(403).json({ error: "platform administration is alta_admin only" });
    return false;
  }
  return true;
}

apiRouter.get(
  "/platform/tenants",
  asyncRoute(async (req, res) => {
    if (!requirePlatform(req, res)) return;
    res.json(await listTenants());
  })
);

const CreateHotelBody = z.object({
  propertyId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,40}$/, "lowercase slug"),
  name: z.string().min(2).max(120),
  plan: z.enum(TENANT_PLANS),
  quotaGb: z.number().int().min(1).max(1000),
  managerName: z.string().min(2).max(80),
  managerUsername: z.string().regex(/^[a-z0-9_.]{3,40}$/),
  managerPassword: z.string().min(10).max(200),
});

apiRouter.post(
  "/platform/hotels",
  asyncRoute(async (req, res) => {
    if (!requirePlatform(req, res)) return;
    const body = CreateHotelBody.parse(req.body);
    const result = await createHotel({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name },
      ...body,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json(result);
  })
);

const TenantPatch = z.object({
  plan: z.enum(TENANT_PLANS).optional(),
  quotaGb: z.number().int().min(1).max(1000).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

apiRouter.patch(
  "/platform/tenants/:id",
  asyncRoute(async (req, res) => {
    if (!requirePlatform(req, res)) return;
    const { id } = z.object({ id: z.string().min(3).max(80) }).parse(req.params);
    const body = TenantPatch.parse(req.body);
    const result = await setTenantState({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name },
      tenantId: id,
      ...body,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ updated: true });
  })
);

// ---- social media manager (§6-هـ, multi-channel) -----------------------

apiRouter.get(
  "/social/channels",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json(await listChannels(req.staff!.propertyId));
  })
);

const ChannelPatch = z.object({
  enabled: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
  handle: z.string().max(120).optional(),
  postsPerWeek: z.number().int().min(0).max(50).optional(),
  bestTimes: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(8).optional(),
  tone: z.string().max(200).optional(),
  hashtags: z.array(z.string().min(1).max(60)).max(30).optional(),
  audienceNote: z.string().max(400).optional(),
});

apiRouter.patch(
  "/social/channels/:channel",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.manage")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { channel } = z.object({ channel: z.enum(CHANNEL_KEYS as [string, ...string[]]) }).parse(req.params);
    const body = ChannelPatch.parse(req.body);
    const result = await updateChannel({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name, propertyId: req.staff!.propertyId },
      channel,
      patch: body,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.channel);
  })
);

apiRouter.post(
  "/social/channels/:channel/generate",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.manage")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { channel } = z.object({ channel: z.enum(CHANNEL_KEYS as [string, ...string[]]) }).parse(req.params);
    const { count } = z.object({ count: z.number().int().min(1).max(5).optional() }).parse(req.body ?? {});
    const result = await generateForChannel({
      propertyId: req.staff!.propertyId,
      channel,
      count,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json(result);
  })
);

apiRouter.get(
  "/social/calendar",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const days = Math.min(60, Math.max(1, Number(req.query.days ?? 14)));
    res.json(await channelCalendar(req.staff!.propertyId, days));
  })
);

apiRouter.get(
  "/social/analytics",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json(await channelAnalytics(req.staff!.propertyId));
  })
);

// Starts a connection: says whether this channel opens an OAuth redirect,
// needs a pasted token, or has no automated surface at all.
apiRouter.post(
  "/social/channels/:channel/connect",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.manage")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { channel } = z.object({ channel: z.enum(CHANNEL_KEYS as [string, ...string[]]) }).parse(req.params);
    const start = startConnect(channel, req.staff!.propertyId);
    if (!start) {
      res.status(404).json({ error: "unknown channel" });
      return;
    }
    res.json(start);
  })
);

// Stores a pasted credential in the vault after the platform accepts it.
apiRouter.post(
  "/social/channels/:channel/credentials",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.manage")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { channel } = z.object({ channel: z.enum(CHANNEL_KEYS as [string, ...string[]]) }).parse(req.params);
    const body = z
      .object({ token: z.string().min(8).max(4000), account: z.string().max(200).optional() })
      .parse(req.body);
    const result = await saveChannelCredentials({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name, propertyId: req.staff!.propertyId },
      channel,
      ...body,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ connected: true, detail: result.detail });
  })
);

apiRouter.delete(
  "/social/channels/:channel/connection",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "social.manage")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { channel } = z.object({ channel: z.enum(CHANNEL_KEYS as [string, ...string[]]) }).parse(req.params);
    await disconnectChannel({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name, propertyId: req.staff!.propertyId },
      channel,
    });
    res.status(204).end();
  })
);

// ---- complaint & reputation manager (§6-د, pre-publication) ------------

apiRouter.get(
  "/complaints",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "complaints.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const cases = await prisma.complaintCase.findMany({
      where: { propertyId: req.staff!.propertyId, ...(status ? { status } : {}) },
      orderBy: [{ reputationRisk: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    res.json(cases);
  })
);

apiRouter.get(
  "/complaints/patterns",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "complaints.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.json(await complaintPatterns(req.staff!.propertyId));
  })
);

apiRouter.post(
  "/complaints",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "complaints.investigate")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const body = z
      .object({ text: z.string().min(3).max(4000), guestId: z.string().uuid().optional() })
      .parse(req.body);
    const { kase, triage } = await captureComplaint({
      propertyId: req.staff!.propertyId,
      text: body.text,
      guestId: body.guestId,
      source: "staff",
    });
    res.status(201).json({ case: kase, triage });
  })
);

apiRouter.get(
  "/complaints/:id",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "complaints.view")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const kase = await ownCase(req.staff!.propertyId, id);
    if (!kase) {
      res.status(404).json({ error: "case not found" });
      return;
    }
    res.json(kase);
  })
);

apiRouter.post(
  "/complaints/:id/rca",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "complaints.investigate")) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const body = z
      .object({
        answers: z.array(z.object({ question: z.string(), answer: z.string().max(1000) })).max(10),
        rootCause: z.string().min(3).max(600),
        contributing: z.array(z.string().max(300)).max(10).optional(),
      })
      .parse(req.body);
    const result = await recordRca({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name, propertyId: req.staff!.propertyId },
      caseId: id,
      ...body,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ actions: result.actions });
  })
);

apiRouter.patch(
  "/complaints/:id",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const body = z
      .object({
        status: z.enum(CASE_STATUSES).optional(),
        actions: z
          .array(z.object({ action: z.string(), owner: z.string(), dueAt: z.string(), done: z.boolean() }))
          .max(20)
          .optional(),
        preventive: z.string().max(600).optional(),
        ownerId: z.string().uuid().optional(),
        resolutionNote: z.string().max(1000).optional(),
      })
      .parse(req.body);
    // Closing a case is a manager act; everything else is investigation.
    const needed = body.status === "resolved" ? "complaints.resolve" : "complaints.investigate";
    if (!can(req.staff!.role, needed)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const result = await updateCase({
      actor: { staffId: req.staff!.staffId, name: req.staff!.name, propertyId: req.staff!.propertyId },
      caseId: id,
      ...body,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ updated: true });
  })
);

// ---- conversations / inbox (§4 صندوق رسائل النزلاء, §6-ب) --------------

/** Loads a conversation and proves it belongs to the caller's property —
 *  the same §11-1 rule as everywhere else, enforced before any action. */
async function ownConversation(req: Request, res: Response, id: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: { guest: true },
  });
  if (!conv || conv.guest.propertyId !== req.staff!.propertyId) {
    res.status(conv ? 403 : 404).json({ error: conv ? "not your property" : "conversation not found" });
    return null;
  }
  return conv;
}

apiRouter.get(
  "/conversations",
  asyncRoute(async (req, res) => {
    const conversations = await prisma.conversation.findMany({
      where: { guest: { propertyId: req.staff!.propertyId } },
      include: {
        guest: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(
      conversations.map((c) => ({
        id: c.id,
        guest: { id: c.guest.id, whatsappId: c.guest.whatsappId, name: c.guest.name },
        aiPaused: c.aiPaused,
        takenOverBy: c.takenOverBy,
        lastMessage: c.messages[0]
          ? { text: c.messages[0].rawText, direction: c.messages[0].direction, at: c.messages[0].createdAt.toISOString() }
          : null,
      }))
    );
  })
);

apiRouter.get(
  "/conversations/:id/messages",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const conv = await ownConversation(req, res, id);
    if (!conv) return;
    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    res.json(messages.map((m) => ({ id: m.id, direction: m.direction, text: m.rawText, mediaType: m.mediaType, at: m.createdAt.toISOString() })));
  })
);

// §6-ب step 1-2: staff presses «استلام المحادثة»; aiPaused flips true and
// every automatic reply stops immediately (enforced in the ingest worker,
// including for jobs already in flight).
apiRouter.post(
  "/conversations/:id/takeover",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const conv = await ownConversation(req, res, id);
    if (!conv) return;
    await prisma.conversation.update({
      where: { id },
      data: { aiPaused: true, takenOverBy: req.staff!.name, takenOverAt: new Date() },
    });
    await emitEvent(req.staff!.propertyId, { type: "conversation.takenover", conversationId: id, by: req.staff!.name });
    await recordAudit({
      ...auditContextFrom(req),
      action: "conversation.takeover",
      resourceType: "Conversation",
      resourceId: id,
    });
    res.json({ aiPaused: true });
  })
);

// §6-ب step 4: only an authorised manager may hand the conversation back
// to the AI.
apiRouter.post(
  "/conversations/:id/resume-ai",
  asyncRoute(async (req, res) => {
    if (!can(req.staff!.role, "conversations.resume_ai")) {
      res.status(403).json({ error: "only a manager can return a conversation to AI" });
      return;
    }
    const { id } = IdParam.parse(req.params);
    const conv = await ownConversation(req, res, id);
    if (!conv) return;
    await prisma.conversation.update({
      where: { id },
      data: { aiPaused: false, takenOverBy: null, takenOverAt: null },
    });
    await emitEvent(req.staff!.propertyId, { type: "conversation.resumed", conversationId: id, by: req.staff!.name });
    await recordAudit({
      ...auditContextFrom(req),
      action: "conversation.resume_ai",
      resourceType: "Conversation",
      resourceId: id,
    });
    res.json({ aiPaused: false });
  })
);

// §6-ب step 3: the manual staff reply, through the same gateway the AI
// uses, so delivery and persistence behave identically.
apiRouter.post(
  "/conversations/:id/reply",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { text } = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    const conv = await ownConversation(req, res, id);
    if (!conv) return;
    await sendWhatsAppMessage(id, text);
    await recordAudit({
      ...auditContextFrom(req),
      action: "conversation.manual_reply",
      resourceType: "Conversation",
      resourceId: id,
      metadata: { preview: text.slice(0, 120) },
    });
    res.status(201).json({ sent: true });
  })
);

apiRouter.get(
  "/tickets",
  asyncRoute(async (req, res) => {
    const { propertyId: requested } = PropertyIdQuery.parse(req.query);
    const propertyId = scopedPropertyId(req, res, requested);
    if (!propertyId) return;
    await applyPendingEscalations();
    const tickets = await prisma.ticket.findMany({
      where: { intent: { message: { conversation: { guest: { propertyId } } } } },
      include: {
        intent: { include: { message: { include: { conversation: { include: { guest: true } } } } } },
        assignedStaff: true,
        actions: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(tickets);
  })
);

apiRouter.patch(
  "/tickets/:id",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { status } = z.object({ status: z.enum(["open", "in_progress", "done"]) }).parse(req.body);
    const ticket = await prisma.ticket.update({ where: { id }, data: { status } });
    res.json(ticket);
  })
);

apiRouter.get(
  "/guests",
  asyncRoute(async (req, res) => {
    const { propertyId: requested } = PropertyIdQuery.parse(req.query);
    const propertyId = scopedPropertyId(req, res, requested);
    if (!propertyId) return;
    const guests = await prisma.guest.findMany({
      where: { propertyId },
      include: {
        reservations: { orderBy: { checkIn: "desc" }, take: 1 },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { messages: { orderBy: { createdAt: "desc" }, take: 5 } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(guests);
  })
);

apiRouter.get(
  "/reviews",
  asyncRoute(async (req, res) => {
    const { propertyId: requested } = PropertyIdQuery.parse(req.query);
    const propertyId = scopedPropertyId(req, res, requested);
    if (!propertyId) return;
    const items = await listPendingReviews(propertyId);
    res.json(items);
  })
);

const ReviewDecision = z.object({
  action: z.enum(["approve", "reject"]),
  editedReply: z.string().optional(),
});

apiRouter.patch(
  "/reviews/:id",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const payload = ReviewDecision.parse(req.body);
    // reviewedBy comes from the authenticated session, never the request
    // body — a client-supplied name couldn't be trusted as an audit trail.
    const reviewedBy = req.staff!.name;
    const result =
      payload.action === "approve"
        ? await approveReview(id, payload.editedReply, reviewedBy)
        : await rejectReview(id, reviewedBy);

    // The single most consequential staff action in the system: approving
    // sends a message to a real guest and mutates a real reservation.
    // Records whether the draft was edited, since "the agent wrote it" and
    // "a human rewrote it" are materially different for accountability.
    await recordAudit({
      ...auditContextFrom(req),
      action: `review.${payload.action}`,
      resourceType: "ReviewItem",
      resourceId: id,
      metadata: {
        department: result.department,
        edited: Boolean(payload.editedReply?.trim()),
        finalReply: payload.editedReply?.trim() || result.draftReply,
      },
    });
    res.json(result);
  })
);

apiRouter.get(
  "/reports/daily",
  asyncRoute(async (req, res) => {
    const { propertyId: requested } = RequiredPropertyIdQuery.parse(req.query);
    const propertyId = scopedPropertyId(req, res, requested);
    if (!propertyId) return;
    res.json(await generateDailyReport(propertyId));
  })
);

apiRouter.get(
  "/metrics",
  asyncRoute(async (req, res) => {
    const { propertyId: requested } = PropertyIdQuery.parse(req.query);
    const propertyId = scopedPropertyId(req, res, requested);
    if (!propertyId) return;
    await applyPendingEscalations();
    const ticketWhere = { intent: { message: { conversation: { guest: { propertyId } } } } };
    const urgentIntentWhere = { urgency: "urgent", message: { conversation: { guest: { propertyId } } } };

    const [totalTickets, openTickets, escalatedTickets, urgentIntents, guestCount, pendingReviews] =
      await Promise.all([
        prisma.ticket.count({ where: ticketWhere }),
        prisma.ticket.count({ where: { ...ticketWhere, status: { not: "done" } } }),
        prisma.ticket.count({ where: { ...ticketWhere, status: "open", escalatedAt: { not: null } } }),
        prisma.intent.count({ where: urgentIntentWhere }),
        prisma.guest.count({ where: propertyId ? { propertyId } : undefined }),
        prisma.reviewItem.count({
          where: {
            status: "pending",
            ...(propertyId ? { intent: { message: { conversation: { guest: { propertyId } } } } } : {}),
          },
        }),
      ]);

    res.json({ totalTickets, openTickets, escalatedTickets, urgentIntents, guestCount, pendingReviews });
  })
);
