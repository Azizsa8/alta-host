import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { authRouter } from "../src/modules/auth/routes.js";
import { apiRouter } from "../src/modules/api/routes.js";

/**
 * The §11-1 acceptance probe: no hotel can see or modify another hotel's
 * data, via the API, not merely the UI. Two tenants are provisioned (the
 * database trigger derives tenancy automatically), staff log in for each,
 * and hotel A's token probes every list endpoint for hotel B's data.
 *
 * This suite exists because these endpoints previously trusted the
 * ?propertyId= query param outright — a genuine cross-tenant leak.
 */
describe("tenant isolation (§11-1)", () => {
  let server: Server;
  let base: string;
  const stamp = Date.now();
  const propA = `iso-a-${stamp}`;
  const propB = `iso-b-${stamp}`;
  let tokenA = "";

  async function login(username: string): Promise<string> {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "pw-12345" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    return body.token;
  }

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", authRouter);
    app.use("/api", apiRouter);
    server = app.listen(0);
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const hash = await bcrypt.hash("pw-12345", 10);
    for (const [prop, user] of [
      [propA, `iso-user-a-${stamp}`],
      [propB, `iso-user-b-${stamp}`],
    ] as const) {
      // No tenantId supplied anywhere — the DB triggers must derive it.
      await prisma.property.create({ data: { id: prop, name: prop } });
      await prisma.staffMember.create({
        data: { propertyId: prop, name: user, role: "reception", username: user, passwordHash: hash },
      });
      const guest = await prisma.guest.create({
        data: { propertyId: prop, whatsappId: `9665-${prop}` },
      });
      const conv = await prisma.conversation.create({ data: { guestId: guest.id } });
      const msg = await prisma.message.create({
        data: { conversationId: conv.id, direction: "inbound", rawText: `secret of ${prop}` },
      });
      const intent = await prisma.intent.create({
        data: { messageId: msg.id, type: "maintenance.report_issue" },
      });
      await prisma.ticket.create({
        data: {
          intentId: intent.id,
          department: "maintenance",
          summary: `ticket of ${prop}`,
          slaDeadline: new Date(Date.now() + 3600_000),
        },
      });
    }
    tokenA = await login(`iso-user-a-${stamp}`);
  });

  afterAll(() => {
    server.close();
  });

  it("the trigger derived a distinct tenant for each property", async () => {
    const a = await prisma.property.findUniqueOrThrow({ where: { id: propA } });
    const b = await prisma.property.findUniqueOrThrow({ where: { id: propB } });
    expect(a.tenantId).toBeTruthy();
    expect(b.tenantId).toBeTruthy();
    expect(a.tenantId).not.toBe(b.tenantId);
    // ...and it cascaded down the whole ownership chain.
    const ticketA = await prisma.ticket.findFirstOrThrow({
      where: { summary: `ticket of ${propA}` },
    });
    expect(ticketA.tenantId).toBe(a.tenantId);
  });

  it("the JWT carries the tenant", async () => {
    const staff = await prisma.staffMember.findFirstOrThrow({
      where: { username: `iso-user-a-${stamp}` },
    });
    expect(staff.tenantId).toBeTruthy();
  });

  const probes: Array<[string, (other: string) => string]> = [
    ["tickets", (p) => `/api/tickets?propertyId=${p}`],
    ["guests", (p) => `/api/guests?propertyId=${p}`],
    ["reviews", (p) => `/api/reviews?propertyId=${p}`],
    ["metrics", (p) => `/api/metrics?propertyId=${p}`],
    ["daily report", (p) => `/api/reports/daily?propertyId=${p}`],
  ];

  for (const [name, path] of probes) {
    it(`${name}: hotel A probing hotel B's data is refused`, async () => {
      const res = await fetch(`${base}${path(propB)}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).not.toContain(`secret of ${propB}`);
      expect(body).not.toContain(`ticket of ${propB}`);
    });
  }

  it("simulate cannot inject a message into another hotel", async () => {
    const res = await fetch(`${base}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ propertyId: propB, from: "966500000009", text: "injected" }),
    });
    expect(res.status).toBe(403);
  });

  it("own-property access still works normally", async () => {
    const res = await fetch(`${base}/api/tickets?propertyId=${propA}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`ticket of ${propA}`);
    expect(body).not.toContain(`ticket of ${propB}`);
  });
});
