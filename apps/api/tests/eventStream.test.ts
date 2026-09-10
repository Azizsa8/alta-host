import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../src/db.js";
import { sseRouter } from "../src/modules/events/sse.js";
import { signStaffToken } from "../src/modules/auth/tokens.js";

/**
 * The live feed behind the Ops Center. It froze on the Railway demo: the
 * browser dropped the stream on a network change, its one automatic retry
 * failed, and it never tried again — while the badge still said "live".
 * The dashboard now owns reconnection; these pin the server half it
 * depends on, over a real HTTP connection.
 */
describe("live event stream", () => {
  const stamp = Date.now();
  const propertyId = `sse-${stamp}`;
  let server: Server;
  let base = "";
  let token = "";
  const seqs: bigint[] = [];

  beforeAll(async () => {
    process.env.SSE_HEARTBEAT_MS = "200";
    await prisma.property.create({ data: { id: propertyId, name: "Stream Hotel" } });
    for (let i = 0; i < 3; i++) {
      const row = await prisma.altaEvent.create({
        data: { propertyId, type: "ticket.created", payload: JSON.stringify({ n: i }) },
      });
      seqs.push(row.seq);
    }
    token = signStaffToken({ staffId: "s1", tenantId: `tnt-${propertyId}`, propertyId, name: "Reem", role: "hotel_manager" });

    const app = express();
    app.use("/api", sseRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env.SSE_HEARTBEAT_MS;
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  /** Reads the stream for `ms`, then aborts and returns headers + body. */
  async function read(query: string, ms: number, headers: Record<string, string> = {}) {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events/stream?token=${token}${query}`, { signal: ctrl.signal, headers });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
      }
    } catch {
      /* aborted — expected */
    } finally {
      clearTimeout(timer);
    }
    return { res, body };
  }

  it("tells the browser how soon to retry, and opts out of proxy buffering", async () => {
    const { res, body } = await read("", 150);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toMatch(/^retry: \d+/m);
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toContain("no-transform");
  });

  it("heartbeats as a NAMED event the page can see, not an invisible comment", async () => {
    const { body } = await read("", 700);
    // Browsers never hand SSE comments (": ping") to page code, so only a
    // named event can feed the dashboard's dead-connection watchdog.
    const beats = body.match(/^event: ping$/gm) ?? [];
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(body).not.toMatch(/^: ping$/m);
  });

  it("replays missed events from a cursor passed in the QUERY", async () => {
    // A rebuilt EventSource cannot set Last-Event-ID, so the dashboard
    // sends the cursor as ?lastEventId= — it must resume exactly after it.
    const { body } = await read(`&lastEventId=${seqs[0]}`, 300);
    const ids = [...body.matchAll(/^id: (\d+)$/gm)].map((m) => m[1]);
    expect(ids).toEqual([seqs[1].toString(), seqs[2].toString()]);
  });

  it("still honours the standard Last-Event-ID header from the browser's own retry", async () => {
    const { body } = await read("", 300, { "Last-Event-ID": seqs[1].toString() });
    const ids = [...body.matchAll(/^id: (\d+)$/gm)].map((m) => m[1]);
    expect(ids).toEqual([seqs[2].toString()]);
  });

  it("ignores a malformed cursor instead of erroring or replaying everything", async () => {
    const { res, body } = await read("&lastEventId=abc;drop", 200);
    expect(res.status).toBe(200);
    expect(body).not.toMatch(/^id: /m);
  });

  it("refuses a stream without a valid token", async () => {
    const res = await fetch(`${base}/api/events/stream?token=nope`);
    expect(res.status).toBe(401);
  });
});
