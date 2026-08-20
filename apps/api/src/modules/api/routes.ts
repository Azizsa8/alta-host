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
import { recordAudit, auditContextFrom, verifyAuditChain } from "../audit/service.js";
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
    if (req.staff!.role !== "manager") {
      res.status(403).json({ error: "only managers can manage credentials" });
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
    if (req.staff!.role !== "manager") {
      res.status(403).json({ error: "only managers can manage credentials" });
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

apiRouter.get(
  "/tickets",
  asyncRoute(async (req, res) => {
    const { propertyId } = PropertyIdQuery.parse(req.query);
    await applyPendingEscalations();
    const tickets = await prisma.ticket.findMany({
      where: propertyId ? { intent: { message: { conversation: { guest: { propertyId } } } } } : undefined,
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
    const { propertyId } = PropertyIdQuery.parse(req.query);
    const guests = await prisma.guest.findMany({
      where: propertyId ? { propertyId } : undefined,
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
    const { propertyId } = PropertyIdQuery.parse(req.query);
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
    const { propertyId } = RequiredPropertyIdQuery.parse(req.query);
    res.json(await generateDailyReport(propertyId));
  })
);

apiRouter.get(
  "/metrics",
  asyncRoute(async (req, res) => {
    const { propertyId } = PropertyIdQuery.parse(req.query);
    await applyPendingEscalations();
    const ticketWhere = propertyId
      ? { intent: { message: { conversation: { guest: { propertyId } } } } }
      : undefined;
    const urgentIntentWhere = propertyId
      ? { urgency: "urgent", message: { conversation: { guest: { propertyId } } } }
      : { urgency: "urgent" };

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
