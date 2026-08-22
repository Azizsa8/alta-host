import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { authRouter } from "../src/modules/auth/routes.js";
import { apiRouter } from "../src/modules/api/routes.js";
import { signStaffToken, verifyStaffToken } from "../src/modules/auth/tokens.js";

describe("staff token sign/verify", () => {
  it("round-trips a payload", () => {
    const token = signStaffToken({ staffId: "s1", tenantId: "t1", propertyId: "p1", name: "Test Staff", role: "reception" });
    const decoded = verifyStaffToken(token);
    expect(decoded).toMatchObject({ staffId: "s1", propertyId: "p1", name: "Test Staff", role: "reception" });
  });

  it("rejects a garbage token", () => {
    expect(verifyStaffToken("not-a-real-token")).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "secret-a";
    const token = signStaffToken({ staffId: "s1", tenantId: "t1", propertyId: "p1", name: "Test Staff", role: "reception" });
    process.env.JWT_SECRET = "secret-b";
    expect(verifyStaffToken(token)).toBeNull();
    process.env.JWT_SECRET = original;
  });
});

describe("auth HTTP surface — real Express app, real requests", () => {
  let server: Server;
  let baseUrl: string;
  let propertyId: string;
  let username: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", authRouter);
    app.use("/api", apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const property = await prisma.property.create({ data: { name: "Auth Test Hotel" } });
    propertyId = property.id;
    username = `auth-test-${Date.now()}`;
    await prisma.staffMember.create({
      data: {
        propertyId: property.id,
        name: "Auth Test Staff",
        role: "reception",
        username,
        passwordHash: await bcrypt.hash("correct-password", 10),
      },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects login with the wrong password", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects login for a username that doesn't exist", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "no-such-user", password: "anything" }),
    });
    expect(res.status).toBe(401);
  });

  it("logs in with the right credentials and returns a usable token", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "correct-password" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; staff: { name: string; propertyId: string } };
    expect(body.token).toBeTruthy();
    expect(body.staff).toMatchObject({ name: "Auth Test Staff", propertyId });

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { staff: { name: string } };
    expect(meBody.staff.name).toBe("Auth Test Staff");
  });

  it("blocks the rest of the API without a token — the actual gap this closes", async () => {
    const res = await fetch(`${baseUrl}/api/tickets?propertyId=${propertyId}`);
    expect(res.status).toBe(401);
  });

  it("blocks the rest of the API with a garbage token", async () => {
    const res = await fetch(`${baseUrl}/api/tickets?propertyId=${propertyId}`, {
      headers: { Authorization: "Bearer garbage" },
    });
    expect(res.status).toBe(401);
  });

  it("allows the rest of the API with a valid token", async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "correct-password" }),
    });
    const { token } = (await login.json()) as { token: string };

    const res = await fetch(`${baseUrl}/api/tickets?propertyId=${propertyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
