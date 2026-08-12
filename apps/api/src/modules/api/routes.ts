import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { handleInbound } from "../whatsapp/webhook.js";
import { listPendingReviews } from "../reviews/reviewService.js";
import { approveReview, rejectReview } from "../reviews/reviewOrchestrator.js";
import { generateDailyReport } from "../reports/dailyReport.js";
import { applyPendingEscalations } from "../tickets/ticketService.js";

export const apiRouter = Router();

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
  reviewedBy: z.string().optional(),
});

apiRouter.patch(
  "/reviews/:id",
  asyncRoute(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const payload = ReviewDecision.parse(req.body);
    const result =
      payload.action === "approve"
        ? await approveReview(id, payload.editedReply, payload.reviewedBy)
        : await rejectReview(id, payload.reviewedBy);
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
