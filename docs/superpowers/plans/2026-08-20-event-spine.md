# Event Spine (Architecture v2, Phase 1A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline webhook processing and dashboard polling with a durable BullMQ ingestion queue, a persisted + Redis-pub/sub domain event bus, an SSE live feed, and a first-class visible agent registry — the spine the Operations Center UI and Mastra runtime (Phase 1B) build on.

**Architecture:** Every meaningful step in the pipeline (message received, intent extracted, agent started/completed, review queued/decided, ticket created) emits a typed `AltaEvent`. Events are written to Postgres (replayable) and published on Redis pub/sub in one call. An authenticated SSE endpoint fans events out per property; the dashboard subscribes instead of polling. Inbound WhatsApp webhooks enqueue to BullMQ and return 200 immediately; per-property-keyed workers run the existing orchestrator. Agent definitions move from implicit switch-cases into a declarative registry exposed over the API.

**Tech Stack:** BullMQ + ioredis (Redis 7), Prisma/Postgres (event persistence), Express SSE, Zod, existing pino logging. Langfuse tracing lands in Phase 1B alongside Mastra (tracing hand-rolled orchestrator code we're about to replace would be throwaway work).

**Spec:** Approved architecture decision recorded in `~/.claude/.../memory/project_architecture_v2.md` (Mastra + BullMQ/Hatchet + Langfuse + custom react-flow Ops Center). This plan implements the BullMQ/event/SSE/registry slice.

## Global Constraints

- TypeScript strict, ESM with explicit `.js` import extensions (NodeNext) — matches the whole `apps/api` codebase.
- All request validation via Zod; Prisma only through the shared client `apps/api/src/db.ts`.
- The propose/execute split is load-bearing: nothing in this plan may make a PMS mutation reachable outside `approveReview`/`AUTO_APPROVE_INTENTS`.
- Prisma migrations are hand-written under `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql` then `prisma migrate deploy` (non-interactive environment — `migrate dev` fails here).
- New services in `docker-compose.yml` must not break the default `docker compose up` path; Redis joins the default profile (the queue is core now), everything WAHA stays behind `--profile dev`.
- Never commit `.env`; update both `.env.example` files when adding env vars.
- `npm install` at repo root only (workspace lockfile).

## File Structure

```
apps/api/src/
  redis.ts                       (new) shared ioredis connections (bullmq + pub/sub need separate clients)
  modules/events/
    types.ts                     (new) AltaEvent union + Zod schemas (AG-UI-inspired taxonomy)
    bus.ts                       (new) emitEvent(): persist to Postgres + publish to Redis channel
    sse.ts                       (new) GET /api/events/stream — auth'd, per-property, Last-Event-ID replay
  modules/ingest/
    queue.ts                     (new) BullMQ queue + worker for inbound messages, per-property group keys
  modules/agents/
    registry.ts                  (new) declarative AgentDefinition[] — the visible fleet config
  modules/api/routes.ts          (modify) mount GET /agents, GET /events/recent
  modules/orchestrator/index.ts  (modify) emit events at each pipeline step
  modules/whatsapp/webhook.ts    (modify) enqueue instead of inline processing
  server.ts                      (modify) mount SSE router, start worker
apps/api/prisma/
  schema.prisma                  (modify) AltaEvent model
  migrations/<ts>_add_alta_event/migration.sql (new, hand-written)
apps/api/tests/
  events.test.ts                 (new)
  ingest.test.ts                 (new)
apps/dashboard/src/
  api/client.ts                  (modify) EventSource helper
  App.tsx                        (modify) replace 4s polling with SSE-driven refresh
docker-compose.yml               (modify) redis service + REDIS_URL
.env.example, apps/api/.env.example (modify) REDIS_URL
```

---

### Task 1: Redis service + shared connection module

**Files:**
- Modify: `docker-compose.yml` (after the `db:` service)
- Modify: `.env.example`, `apps/api/.env.example`
- Create: `apps/api/src/redis.ts`
- Modify: `apps/api/package.json` (deps: `bullmq`, `ioredis`)

**Interfaces:**
- Produces: `getRedis(): Redis` (lazy singleton for general use/pub), `createRedisConnection(): Redis` (fresh connection — BullMQ workers and pub/sub subscribers each need their own), both reading `REDIS_URL` (default `redis://localhost:6379`).

- [ ] **Step 1: Add redis to docker-compose.yml**

```yaml
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - alta-redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Add `alta-redis-data:` under `volumes:`, add to the `api` service environment: `REDIS_URL: redis://redis:6379`, and add `redis` (condition `service_healthy`) to the api service's `depends_on`.

- [ ] **Step 2: Add REDIS_URL to both .env.example files**

```
# Redis backs the inbound-message queue (BullMQ) and the live event feed
# (pub/sub → SSE). Local dev: docker compose up -d redis.
REDIS_URL=redis://localhost:6379
```

- [ ] **Step 3: Install deps**

Run at repo root: `npm install bullmq ioredis --workspace apps/api`

- [ ] **Step 4: Create apps/api/src/redis.ts**

```ts
import { Redis } from "ioredis";

const url = () => process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires maxRetriesPerRequest: null on its connections; harmless
// for our own use, so one shared config keeps the two paths identical.
export function createRedisConnection(): Redis {
  return new Redis(url(), { maxRetriesPerRequest: null });
}

let shared: Redis | undefined;
/** Lazy shared connection for publishes and one-off commands. Subscribers
 *  and BullMQ workers must call createRedisConnection() instead — a Redis
 *  connection in subscriber mode can't issue regular commands. */
export function getRedis(): Redis {
  shared ??= createRedisConnection();
  return shared;
}
```

- [ ] **Step 5: Verify boot + typecheck**

Run: `docker compose up -d redis && npm run typecheck --workspace apps/api`
Expected: redis healthy in `docker compose ps`; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example apps/api/.env.example apps/api/src/redis.ts apps/api/package.json package-lock.json
git commit -m "feat: add Redis service and shared connection module"
```

### Task 2: AltaEvent persistence model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_alta_event/migration.sql`

**Interfaces:**
- Produces: Prisma model `AltaEvent { id: string (uuid), seq: bigint autoincrement, propertyId: string, type: string, payload: string (JSON), createdAt: DateTime }` — `seq` is the SSE `Last-Event-ID` cursor.

- [ ] **Step 1: Add model to schema.prisma**

```prisma
// Domain events powering the live Operations Center feed (SSE) and
// incident replay. Append-only; seq is the SSE Last-Event-ID cursor.
model AltaEvent {
  id         String   @id @default(uuid())
  seq        BigInt   @default(autoincrement()) @unique
  propertyId String
  type       String
  payload    String   // JSON-encoded event body (typed via modules/events/types.ts)
  createdAt  DateTime @default(now())

  @@index([propertyId, seq])
}
```

- [ ] **Step 2: Hand-write the migration**

Create `apps/api/prisma/migrations/20260820200000_add_alta_event/migration.sql`:

```sql
CREATE TABLE "AltaEvent" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AltaEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AltaEvent_seq_key" ON "AltaEvent"("seq");
CREATE INDEX "AltaEvent_propertyId_seq_idx" ON "AltaEvent"("propertyId", "seq");
```

- [ ] **Step 3: Apply + regenerate client**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate`
Expected: migration applied, client regenerated.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat: add AltaEvent append-only domain event table"
```

### Task 3: Event types + bus

**Files:**
- Create: `apps/api/src/modules/events/types.ts`
- Create: `apps/api/src/modules/events/bus.ts`
- Test: `apps/api/tests/events.test.ts`

**Interfaces:**
- Consumes: `getRedis()` from Task 1, `AltaEvent` model from Task 2.
- Produces: `AltaEventBody` (discriminated union on `type`), `emitEvent(propertyId: string, body: AltaEventBody): Promise<void>`, `EVENTS_CHANNEL = "alta:events"`, wire format on pub/sub: `JSON.stringify({ seq: string, propertyId, type, payload, createdAt })`.

- [ ] **Step 1: Create types.ts (AG-UI-inspired taxonomy, ALTA vocabulary)**

```ts
// Event taxonomy for the live ops feed. Names follow the AG-UI convention
// (lifecycle verbs on dotted subjects) so a future protocol adapter is a
// rename, not a redesign.
export type AltaEventBody =
  | { type: "message.received"; conversationId: string; guestId: string; mediaType: "text" | "voice"; preview: string }
  | { type: "intent.extracted"; messageId: string; intents: Array<{ type: string; confidence: number }>; sentiment: string; urgency: string }
  | { type: "agent.started"; agentKey: string; intentId: string; intentType: string }
  | { type: "agent.completed"; agentKey: string; intentId: string; outcome: "sent" | "queued_for_review"; replyPreview?: string }
  | { type: "review.queued"; reviewItemId: string; department: string; intentId: string }
  | { type: "review.decided"; reviewItemId: string; decision: "approved" | "rejected"; reviewedBy: string }
  | { type: "ticket.created"; ticketId: string; department: string; urgency: string; summary: string }
  | { type: "ticket.escalated"; ticketId: string; department: string };

export type AltaEventType = AltaEventBody["type"];

export interface PublishedEvent {
  seq: string; // BigInt serialized as string
  propertyId: string;
  type: AltaEventType;
  payload: AltaEventBody;
  createdAt: string;
}

export const EVENTS_CHANNEL = "alta:events";
```

- [ ] **Step 2: Write the failing test**

`apps/api/tests/events.test.ts` (follows the existing vitest + real-Postgres pattern used by `auth.test.ts`):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { emitEvent } from "../src/modules/events/bus.js";

describe("event bus", () => {
  const propertyId = `evt-test-${Date.now()}`;

  it("persists the event with a monotonic seq", async () => {
    await emitEvent(propertyId, {
      type: "ticket.created",
      ticketId: "t1",
      department: "maintenance",
      urgency: "urgent",
      summary: "AC broken",
    });
    await emitEvent(propertyId, {
      type: "ticket.escalated",
      ticketId: "t1",
      department: "maintenance",
    });
    const rows = await prisma.altaEvent.findMany({
      where: { propertyId },
      orderBy: { seq: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("ticket.created");
    expect(rows[1].seq).toBeGreaterThan(rows[0].seq);
    expect(JSON.parse(rows[1].payload).ticketId).toBe("t1");
  });

  it("does not throw when Redis is unreachable (persist-first, publish best-effort)", async () => {
    const prev = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:1"; // nothing listens here
    // force a fresh connection path by importing after env change is NOT
    // possible with the singleton — bus.ts must catch publish errors instead.
    await expect(
      emitEvent(propertyId, { type: "ticket.escalated", ticketId: "t2", department: "housekeeping" })
    ).resolves.not.toThrow();
    process.env.REDIS_URL = prev;
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace apps/api -- tests/events.test.ts`
Expected: FAIL — `bus.js` does not exist.

- [ ] **Step 4: Implement bus.ts**

```ts
import { prisma } from "../../db.js";
import { getRedis } from "../../redis.js";
import { logger } from "../../logger.js";
import { EVENTS_CHANNEL, type AltaEventBody, type PublishedEvent } from "./types.js";

/**
 * Persist-first, publish-best-effort: the Postgres row is the source of
 * truth (SSE replay reads it); the Redis publish only accelerates delivery
 * to currently-connected dashboards. A dead Redis must never fail the
 * business operation that emitted the event.
 */
export async function emitEvent(propertyId: string, body: AltaEventBody): Promise<void> {
  const row = await prisma.altaEvent.create({
    data: { propertyId, type: body.type, payload: JSON.stringify(body) },
  });
  const published: PublishedEvent = {
    seq: row.seq.toString(),
    propertyId,
    type: body.type,
    payload: body,
    createdAt: row.createdAt.toISOString(),
  };
  try {
    await getRedis().publish(EVENTS_CHANNEL, JSON.stringify(published));
  } catch (err) {
    logger.warn({ err, type: body.type }, "event publish failed (persisted; live feed will catch up on reconnect)");
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test --workspace apps/api -- tests/events.test.ts`
Expected: PASS (needs `docker compose up -d db redis` running, same as the rest of the suite).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/events apps/api/tests/events.test.ts
git commit -m "feat: typed domain event bus — persist to Postgres, publish to Redis"
```

### Task 4: Emit events from the orchestrator pipeline

**Files:**
- Modify: `apps/api/src/modules/orchestrator/index.ts`
- Modify: `apps/api/src/modules/reviews/reviewOrchestrator.ts` (emit `review.decided`)
- Modify: `apps/api/src/modules/tickets/ticketService.ts` (emit `ticket.created` / `ticket.escalated`)

**Interfaces:**
- Consumes: `emitEvent` from Task 3.
- Produces: the running pipeline emits the full `AltaEventBody` vocabulary; no signature changes to `processInboundMessage`.

- [ ] **Step 1: Orchestrator emissions**

In `processInboundMessage`, after the `prisma.message.create`:

```ts
await emitEvent(params.propertyId, {
  type: "message.received",
  conversationId: params.conversationId,
  guestId: params.guestId,
  mediaType: params.mediaType ?? "text",
  preview: params.text.slice(0, 120),
});
```

After `intentEngine.extract`:

```ts
await emitEvent(params.propertyId, {
  type: "intent.extracted",
  messageId: message.id,
  intents: envelope.intents.map((i) => ({ type: i.type, confidence: i.confidence })),
  sentiment: envelope.sentiment,
  urgency: envelope.urgency,
});
```

In `dispatch`, wrap each case: before handling emit `agent.started` with `agentKey` = `"housekeeping" | "maintenance" | "reception" | "guest_service"` (derive: `intent.type.startsWith("maintenance") ? "maintenance" : ...` matching the existing switch arms), and after the outcome emit `agent.completed` with `outcome: result.status` and `replyPreview: result.reply?.slice(0, 120)`. The `review.queued` emission goes right after each `queueForReview` call with the returned row's `id`.

`dispatch` currently doesn't receive `propertyId`-carrying emissions — it already has `ctx.propertyId`; pass through as-is.

- [ ] **Step 2: Ticket + review emissions**

In `ticketService.ts` `createTicket`, after the create: `emitEvent(params.propertyId, { type: "ticket.created", ticketId: ticket.id, department: params.department, urgency: params.urgency ?? "normal", summary: params.summary })`. In the SLA escalation sweep (`applyPendingEscalations` or equivalent — locate by grepping `escalatedAt`), emit `ticket.escalated` per newly-escalated ticket (the property id is on the ticket row). In `reviewOrchestrator.ts` `approveReview`/`rejectReview`, after `markReviewed`, emit `review.decided` (property id reachable via the included intent→message→conversation→guest chain already loaded there; if not loaded, query the guest's propertyId).

- [ ] **Step 3: Verify with existing suite + manual simulate**

Run: `npm test --workspace apps/api` (full suite — orchestrator tests must stay green)
Then: `npm run dev:api` + POST `/api/simulate` (any seeded guest message) and check `SELECT type, "propertyId" FROM "AltaEvent" ORDER BY seq DESC LIMIT 10;` shows the expected chain.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/orchestrator apps/api/src/modules/reviews apps/api/src/modules/tickets
git commit -m "feat: emit domain events across the whole message pipeline"
```

### Task 5: SSE live feed endpoint

**Files:**
- Create: `apps/api/src/modules/events/sse.ts`
- Modify: `apps/api/src/server.ts` (mount before the general apiLimiter or exempt it — SSE is one long-lived request, the 100/15min cap is fine)
- Modify: `apps/api/src/modules/api/routes.ts` (add `GET /events/recent`)

**Interfaces:**
- Consumes: `createRedisConnection` (dedicated subscriber), `EVENTS_CHANNEL`, `PublishedEvent`, `requireAuth` middleware + `req.staff` (existing auth module), `AltaEvent` model.
- Produces: `GET /api/events/stream` — SSE, scoped to `req.staff.propertyId`, honors `Last-Event-ID` header by replaying persisted rows with `seq >` cursor before going live; each SSE message: `id: <seq>\ndata: <PublishedEvent JSON>\n\n`. `GET /api/events/recent?limit=50` — JSON array of latest PublishedEvents for initial paint.

- [ ] **Step 1: Implement sse.ts**

```ts
import { Router } from "express";
import { prisma } from "../../db.js";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { requireAuth } from "../auth/middleware.js";
import { EVENTS_CHANNEL, type PublishedEvent } from "./types.js";

export const sseRouter = Router();

// One process-wide subscriber fanning out to N connected dashboards —
// never one Redis connection per HTTP client.
type Listener = (evt: PublishedEvent) => void;
const listeners = new Set<Listener>();
let subscriberStarted = false;

function ensureSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  const sub = createRedisConnection();
  sub.subscribe(EVENTS_CHANNEL).catch((err) => logger.error({ err }, "SSE subscribe failed"));
  sub.on("message", (_channel, raw) => {
    try {
      const evt = JSON.parse(raw) as PublishedEvent;
      for (const l of listeners) l(evt);
    } catch (err) {
      logger.warn({ err }, "bad event on channel");
    }
  });
}

function rowToPublished(row: { seq: bigint; propertyId: string; type: string; payload: string; createdAt: Date }): PublishedEvent {
  return {
    seq: row.seq.toString(),
    propertyId: row.propertyId,
    type: row.type as PublishedEvent["type"],
    payload: JSON.parse(row.payload),
    createdAt: row.createdAt.toISOString(),
  };
}

sseRouter.get("/events/stream", requireAuth, async (req, res) => {
  ensureSubscriber();
  const propertyId = req.staff!.propertyId;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const send = (evt: PublishedEvent) => {
    res.write(`id: ${evt.seq}\ndata: ${JSON.stringify(evt)}\n\n`);
  };

  // Replay anything missed since the client's last cursor, then go live.
  const lastId = req.headers["last-event-id"];
  if (typeof lastId === "string" && /^\d+$/.test(lastId)) {
    const missed = await prisma.altaEvent.findMany({
      where: { propertyId, seq: { gt: BigInt(lastId) } },
      orderBy: { seq: "asc" },
      take: 500,
    });
    for (const row of missed) send(rowToPublished(row));
  }

  const listener: Listener = (evt) => {
    if (evt.propertyId === propertyId) send(evt);
  };
  listeners.add(listener);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    listeners.delete(listener);
  });
});
```

- [ ] **Step 2: Mount in server.ts**

After `app.use("/api", authRouter);` add:

```ts
app.use("/api", sseRouter);
```

(with import `import { sseRouter } from "./modules/events/sse.js";`). Must be mounted before `apiRouter` is irrelevant — different paths — but keep it after the auth router. Note: `requireAuth` reads the token from the `Authorization` header; the browser `EventSource` API can't set headers, so the dashboard client (Task 7) passes the JWT as `?token=` and `requireAuth` must accept `req.query.token` as a fallback — add to `apps/api/src/modules/auth/middleware.ts`:

```ts
// EventSource cannot set an Authorization header; accept the same JWT via
// query param for the SSE endpoint only (it's still TLS-protected in prod).
const token =
  req.headers.authorization?.replace(/^Bearer /, "") ??
  (typeof req.query.token === "string" ? req.query.token : undefined);
```

(adapt to the middleware's existing extraction line — keep the rest of its logic untouched).

- [ ] **Step 3: Add GET /events/recent to routes.ts**

Inside `apps/api/src/modules/api/routes.ts` (already behind `requireAuth`):

```ts
apiRouter.get("/events/recent", asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const rows = await prisma.altaEvent.findMany({
    where: { propertyId: req.staff!.propertyId },
    orderBy: { seq: "desc" },
    take: limit,
  });
  res.json(rows.reverse().map((row) => ({
    seq: row.seq.toString(),
    propertyId: row.propertyId,
    type: row.type,
    payload: JSON.parse(row.payload),
    createdAt: row.createdAt.toISOString(),
  })));
}));
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev:api`, then:

```bash
TOKEN=$(curl -s -X POST localhost:4317/api/auth/login -H 'Content-Type: application/json' -d '{"username":"fahad","password":"alta-demo-2026"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -N "localhost:4317/api/events/stream?token=$TOKEN" &
curl -s -X POST localhost:4317/api/simulate -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"propertyId":"<seeded>","text":"the AC is broken"}'
```

Expected: the streaming curl prints `message.received` → `intent.extracted` → `agent.started` → `ticket.created` → `agent.completed` events live.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/events/sse.ts apps/api/src/server.ts apps/api/src/modules/api/routes.ts apps/api/src/modules/auth/middleware.ts
git commit -m "feat: authenticated SSE live event feed with Last-Event-ID replay"
```

### Task 6: BullMQ ingestion queue for the webhook path

**Files:**
- Create: `apps/api/src/modules/ingest/queue.ts`
- Modify: `apps/api/src/modules/whatsapp/webhook.ts`
- Modify: `apps/api/src/server.ts` (start worker with the server)
- Test: `apps/api/tests/ingest.test.ts`

**Interfaces:**
- Consumes: `createRedisConnection`, `processInboundMessage` (unchanged signature), the webhook's existing guest/conversation resolution logic.
- Produces: `enqueueInbound(job: InboundJob): Promise<void>` where `InboundJob = { propertyId: string; guestId: string; conversationId: string; text: string; mediaType?: "text" | "voice"; dedupeKey: string }`; `startIngestWorker(): Worker` with concurrency 5. Jobs are idempotent via `jobId: dedupeKey` (BullMQ drops duplicate jobIds) — `dedupeKey` is the transport message id (WAHA `payload.id` / Cloud API `messages[0].id`), which is Meta's redelivery-dedupe answer.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue } from "bullmq";
import { createRedisConnection } from "../src/redis.js";
import { enqueueInbound, INGEST_QUEUE } from "../src/modules/ingest/queue.js";

describe("ingest queue", () => {
  const connection = createRedisConnection();
  const queue = new Queue(INGEST_QUEUE, { connection });

  afterAll(async () => {
    await queue.close();
    connection.disconnect();
  });

  it("deduplicates by transport message id", async () => {
    const dedupeKey = `dup-${Date.now()}`;
    const job = { propertyId: "p", guestId: "g", conversationId: "c", text: "hi", dedupeKey };
    await enqueueInbound(job);
    await enqueueInbound(job); // same key — must not create a second job
    const counts = await queue.getJobCounts("waiting", "delayed", "completed", "active");
    const j = await queue.getJob(dedupeKey);
    expect(j).toBeTruthy();
    // exactly one job exists under this id
    expect((await queue.getJobs(["waiting", "active", "completed"])).filter((x) => x.id === dedupeKey)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace apps/api -- tests/ingest.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement queue.ts**

```ts
import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../../redis.js";
import { logger } from "../../logger.js";
import { processInboundMessage } from "../orchestrator/index.js";

export const INGEST_QUEUE = "inbound-messages";

export interface InboundJob {
  propertyId: string;
  guestId: string;
  conversationId: string;
  text: string;
  mediaType?: "text" | "voice";
  dedupeKey: string;
}

let queue: Queue<InboundJob> | undefined;
function getQueue(): Queue<InboundJob> {
  queue ??= new Queue<InboundJob>(INGEST_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 24 * 3600, count: 5000 },
      removeOnFail: false, // failed jobs stay visible — they're the DLQ
    },
  });
  return queue;
}

/** Enqueue an inbound guest message; duplicate transport ids are dropped
 *  (WhatsApp redelivers webhooks — jobId is the idempotency key). */
export async function enqueueInbound(job: InboundJob): Promise<void> {
  await getQueue().add("inbound", job, { jobId: job.dedupeKey });
}

export function startIngestWorker(): Worker<InboundJob> {
  const worker = new Worker<InboundJob>(
    INGEST_QUEUE,
    async (job) => {
      await processInboundMessage(job.data);
    },
    { connection: createRedisConnection(), concurrency: 5 }
  );
  worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "inbound job failed"));
  return worker;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm test --workspace apps/api -- tests/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Switch the webhook to enqueue**

In `webhook.ts`, both the `/webhook/whatsapp` and `/webhook/waha` handlers currently `await processInboundMessage(...)` after resolving guest/conversation. Replace that call with:

```ts
await enqueueInbound({
  propertyId,
  guestId: guest.id,
  conversationId: conversation.id,
  text,
  mediaType,
  dedupeKey: transportMessageId, // WAHA: payload.id ; Cloud API: messages[0].id — both already parsed in this file
});
```

and return 200 immediately after. Keep `/api/simulate` synchronous (the dashboard simulator shows the pipeline result inline — it stays a direct `processInboundMessage` call).

- [ ] **Step 6: Start the worker with the server**

In `server.ts` after `app.listen`:

```ts
import { startIngestWorker } from "./modules/ingest/queue.js";
// ...
startIngestWorker();
logger.info("ingest worker started");
```

- [ ] **Step 7: Full suite + live check**

Run: `npm test --workspace apps/api`
Then rebuild containers (`docker compose up -d --build api web`) and send a real WhatsApp message through the paired WAHA session; confirm the ticket appears and `AltaEvent` rows were written.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ingest apps/api/tests/ingest.test.ts apps/api/src/modules/whatsapp/webhook.ts apps/api/src/server.ts
git commit -m "feat: durable BullMQ ingestion — webhook enqueues, worker processes"
```

### Task 7: Visible agent registry + API

**Files:**
- Create: `apps/api/src/modules/agents/registry.ts`
- Modify: `apps/api/src/modules/api/routes.ts`

**Interfaces:**
- Produces: `AgentDefinition { key: string; name: string; nameAr: string; department: "reception" | "guest_service" | "housekeeping" | "maintenance" | "supervisor"; role: string; roleAr: string; riskLevel: "low" | "guest_facing"; reviewPolicy: "immediate" | "human_review"; handlesIntents: string[]; tools: string[]; parent?: string }`, `AGENT_REGISTRY: AgentDefinition[]`, `GET /api/agents` returning the registry.

- [ ] **Step 1: Create registry.ts**

```ts
/**
 * The agent fleet as declarative, inspectable configuration — what the
 * Operations Center renders and what /api/agents exposes. The orchestrator's
 * dispatch switch must stay consistent with handlesIntents here (Phase 1B
 * replaces the switch by driving dispatch FROM this registry via Mastra).
 */
export interface AgentDefinition {
  key: string;
  name: string;
  nameAr: string;
  department: "reception" | "guest_service" | "housekeeping" | "maintenance" | "supervisor";
  role: string;
  roleAr: string;
  riskLevel: "low" | "guest_facing";
  reviewPolicy: "immediate" | "human_review";
  handlesIntents: string[];
  tools: string[];
  parent?: string;
}

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    key: "concierge_supervisor",
    name: "Concierge Supervisor",
    nameAr: "المنسّق الرئيسي",
    department: "supervisor",
    role: "Routes each extracted intent to the correct specialist agent; one guest message may fan out to several agents.",
    roleAr: "يوزّع كل نية مستخرجة على الوكيل المختص؛ رسالة واحدة قد تتفرع لعدة وكلاء.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["*"],
    tools: ["intent_engine", "dispatch"],
  },
  {
    key: "reception",
    name: "Reception Agent",
    nameAr: "وكيل الاستقبال",
    department: "reception",
    role: "Checkout extensions and booking changes against the live PMS; every guest-facing reply waits for human approval.",
    roleAr: "تمديد الخروج وتعديل الحجوزات على نظام الفندق مباشرة؛ كل رد يمر بالمراجعة البشرية.",
    riskLevel: "guest_facing",
    reviewPolicy: "human_review",
    handlesIntents: ["booking.extend_stay", "reception.faq"],
    tools: ["pms.getReservation", "pms.extendCheckout", "review_queue"],
    parent: "concierge_supervisor",
  },
  {
    key: "guest_service",
    name: "Guest Service Agent",
    nameAr: "وكيل خدمة النزلاء",
    department: "guest_service",
    role: "Complaints and general requests; detects sentiment and urgency; replies wait for human approval.",
    roleAr: "الشكاوى والطلبات العامة؛ يرصد المشاعر ودرجة الإلحاح؛ ردوده تمر بالمراجعة البشرية.",
    riskLevel: "guest_facing",
    reviewPolicy: "human_review",
    handlesIntents: ["guest_service.complaint"],
    tools: ["sentiment", "review_queue", "ticketing"],
    parent: "concierge_supervisor",
  },
  {
    key: "housekeeping",
    name: "Housekeeping Agent",
    nameAr: "وكيل التدبير المنزلي",
    department: "housekeeping",
    role: "Room-cleaning requests: creates the ticket and confirms to the guest immediately (no guest-facing risk).",
    roleAr: "طلبات التنظيف: ينشئ التذكرة ويؤكد للنزيل فورًا (بلا خطورة على النزيل).",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["housekeeping.clean_room"],
    tools: ["ticketing", "guest_language"],
    parent: "concierge_supervisor",
  },
  {
    key: "maintenance",
    name: "Maintenance Agent",
    nameAr: "وكيل الصيانة",
    department: "maintenance",
    role: "Fault reports: immediate ticket with SLA deadline; urgent reports auto-escalate.",
    roleAr: "بلاغات الأعطال: تذكرة فورية بمهلة استجابة؛ العاجل يُصعَّد تلقائيًا.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["maintenance.report_issue"],
    tools: ["ticketing", "sla_escalation", "guest_language"],
    parent: "concierge_supervisor",
  },
];
```

- [ ] **Step 2: Expose over the API**

In `routes.ts`:

```ts
import { AGENT_REGISTRY } from "../agents/registry.js";
// ...
apiRouter.get("/agents", (_req, res) => res.json(AGENT_REGISTRY));
```

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck --workspace apps/api`, then `curl -s localhost:4317/api/agents -H "Authorization: Bearer $TOKEN"` returns 5 agents.

```bash
git add apps/api/src/modules/agents/registry.ts apps/api/src/modules/api/routes.ts
git commit -m "feat: declarative agent registry exposed at /api/agents"
```

### Task 8: Dashboard — SSE replaces polling

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`
- Modify: `apps/dashboard/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/events/stream?token=<jwt>` (SSE), `getToken()` from client.ts.
- Produces: `api.eventStream(onEvent: (evt: PublishedEvent) => void): () => void` (returns unsubscribe); `App.tsx` bumps `refreshKey` on any event instead of the 4s interval (targeted per-view store updates come with the Ops Center in Phase 2 — this task only removes polling).

- [ ] **Step 1: Add eventStream to client.ts**

```ts
export interface LiveEvent {
  seq: string;
  propertyId: string;
  type: string;
  payload: Record<string, unknown> & { type: string };
  createdAt: string;
}

/** Opens the authenticated SSE feed. EventSource reconnects automatically
 *  and resends Last-Event-ID, so missed events replay server-side. */
export function eventStream(onEvent: (evt: LiveEvent) => void): () => void {
  const token = getToken();
  if (!token) return () => {};
  const source = new EventSource(`${BASE}/events/stream?token=${encodeURIComponent(token)}`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as LiveEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}
```

(export it alongside `api`; `BASE` is the existing constant in this file.)

- [ ] **Step 2: Replace the polling effect in App.tsx**

Delete the 4s `setInterval` effect added previously and replace with:

```ts
// Live event feed: any pipeline event refreshes the visible view. The 4s
// polling this replaces is gone — SSE is now the only refresh trigger
// besides explicit user actions.
useEffect(() => {
  if (!staff) return;
  return eventStream(() => setRefreshKey((k) => k + 1));
}, [staff]);
```

(import `eventStream` from `./api/client.js`.)

- [ ] **Step 3: Verify in browser**

Rebuild (`docker compose up -d --build web api`), open the dashboard, log in, keep the Ticket Board visible, and send a WhatsApp message via the paired session (or `/api/simulate` with a curl token). Expected: the new ticket appears within ~1s without any interval firing (check the Network tab — one `events/stream` connection, no repeating `/api/tickets` calls except on events).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/App.tsx
git commit -m "feat: dashboard live-updates over SSE, polling removed"
```

### Task 9: Ship it

- [ ] **Step 1: Full verification**

Run: `npm run typecheck --workspace apps/api && npm run test --workspace apps/api && npm run build --workspace apps/dashboard`
Expected: all green.

- [ ] **Step 2: Update README**

Add an "Event spine" section to `README.md`: Redis requirement, the event taxonomy, SSE endpoint, BullMQ queue behavior (retries/dedupe/DLQ), `GET /api/agents`.

- [ ] **Step 3: Branch, push, PR**

```bash
git checkout -b feat/event-spine   # done at plan start if not already
git push -u origin feat/event-spine
gh pr create --base main --title "Event spine: BullMQ ingestion, domain events, SSE live feed, agent registry" --body "Phase 1A of architecture v2 (approved 2026-08-20). Adds Redis+BullMQ durable webhook ingestion with transport-id dedupe, an append-only AltaEvent table + Redis pub/sub bus, an authenticated SSE feed with Last-Event-ID replay, a declarative agent registry at /api/agents, and switches the dashboard from 4s polling to live SSE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review

- **Spec coverage:** BullMQ ingestion ✔ (Task 6), event bus ✔ (Tasks 2–4), SSE ✔ (Task 5), visible agent configs ✔ (Task 7), polling removal ✔ (Task 8). Langfuse + Mastra explicitly deferred to Phase 1B with rationale (avoid instrumenting code about to be replaced).
- **Placeholder scan:** none — all steps carry code or exact commands. Two locate-by-grep instructions (Task 4 step 2) are intentional: exact line positions in files this plan doesn't rewrite.
- **Type consistency:** `PublishedEvent`/`AltaEventBody` (Task 3) used by Tasks 4, 5, 8; `InboundJob.dedupeKey` (Task 6) consistent; `req.staff!.propertyId` matches existing auth middleware typing.
