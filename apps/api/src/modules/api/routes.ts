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
import { recordAudit, auditContextFrom, verifyAuditChain } from "../audit/service.js";
import { emitEvent } from "../events/bus.js";
import { sendWhatsAppMessage } from "../whatsapp/gateway.js";
import { listCredentials, setCredential, deleteCredential, CREDENTIAL_KEYS } from "../credentials/service.js";

export const apiRouter = Router();
// Everything in this router is dashboard/staff-facing — /auth/login and
// /auth/me are mounted separately in server.ts, before this middleware.
apiRouter.use(requireAuth);

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
