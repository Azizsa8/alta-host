import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { handleInbound } from "../whatsapp/webhook.js";
import { listPendingReviews } from "../reviews/reviewService.js";
import { approveReview, rejectReview } from "../reviews/reviewOrchestrator.js";
import { generateDailyReport } from "../reports/dailyReport.js";

export const apiRouter = Router();

// Stands in for a real WhatsApp message in local/demo use — the dashboard's
// Simulator panel posts here so the whole pipeline can be exercised without
// WhatsApp Business API credentials.
const SimulatePayload = z.object({
  propertyId: z.string(),
  from: z.string(),
  text: z.string(),
  guestName: z.string().optional(),
});

apiRouter.post("/simulate", async (req, res) => {
  try {
    const payload = SimulatePayload.parse(req.body);
    const result = await handleInbound(payload);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid payload" });
  }
});

apiRouter.get("/properties", async (_req, res) => {
  const properties = await prisma.property.findMany();
  res.json(properties);
});

apiRouter.get("/tickets", async (req, res) => {
  const propertyId = req.query.propertyId as string | undefined;
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
});

apiRouter.patch("/tickets/:id", async (req, res) => {
  const { status } = z.object({ status: z.enum(["open", "in_progress", "done"]) }).parse(req.body);
  const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data: { status } });
  res.json(ticket);
});

apiRouter.get("/guests", async (req, res) => {
  const propertyId = req.query.propertyId as string | undefined;
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
});

apiRouter.get("/reviews", async (req, res) => {
  const propertyId = req.query.propertyId as string | undefined;
  const items = await listPendingReviews(propertyId);
  res.json(items);
});

const ReviewDecision = z.object({
  action: z.enum(["approve", "reject"]),
  editedReply: z.string().optional(),
  reviewedBy: z.string().optional(),
});

apiRouter.patch("/reviews/:id", async (req, res) => {
  try {
    const payload = ReviewDecision.parse(req.body);
    const result =
      payload.action === "approve"
        ? await approveReview(req.params.id, payload.editedReply, payload.reviewedBy)
        : await rejectReview(req.params.id, payload.reviewedBy);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid request" });
  }
});

apiRouter.get("/reports/daily", async (req, res) => {
  const propertyId = req.query.propertyId as string | undefined;
  if (!propertyId) {
    res.status(400).json({ error: "propertyId is required" });
    return;
  }
  res.json(await generateDailyReport(propertyId));
});

apiRouter.get("/metrics", async (req, res) => {
  const propertyId = req.query.propertyId as string | undefined;
  const ticketWhere = propertyId
    ? { intent: { message: { conversation: { guest: { propertyId } } } } }
    : undefined;

  const [totalTickets, openTickets, urgentIntents, guestCount, pendingReviews] = await Promise.all([
    prisma.ticket.count({ where: ticketWhere }),
    prisma.ticket.count({ where: { ...ticketWhere, status: { not: "done" } } }),
    prisma.intent.count({ where: { urgency: "urgent" } }),
    prisma.guest.count({ where: propertyId ? { propertyId } : undefined }),
    prisma.reviewItem.count({
      where: {
        status: "pending",
        ...(propertyId ? { intent: { message: { conversation: { guest: { propertyId } } } } } : {}),
      },
    }),
  ]);

  res.json({ totalTickets, openTickets, urgentIntents, guestCount, pendingReviews });
});
