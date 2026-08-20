# Mastra Runtime Port (Architecture v2, Phase 1B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled `dispatch()` switch with a real Mastra workflow runtime where the human-review gate is a durable `suspend()`/`resume()` — so a guest-facing action is *structurally* unreachable without approval, and every agent run is an inspectable, replayable workflow execution.

**Architecture:** One `intentWorkflow` run per extracted intent. The workflow proposes a reply, then branches: low-risk intents (housekeeping/maintenance) execute immediately; guest-facing intents (reception/guest_service) **suspend** at a review gate. A `ReviewItem` row carries the `workflowRunId`, so staff approval in the dashboard resumes that exact run — from a different process, hours later, surviving restarts. Verified by spike before writing this plan.

**Tech Stack:** `@mastra/core` 1.60 (workflows only — deterministic, no LLM required), `@mastra/pg` 1.21 `PostgresStore` on the existing database, Zod schemas, the Phase 1A event bus.

**Spec:** `memory/project_architecture_v2.md` (approved 2026-08-20). This plan implements the Mastra slice; Langfuse tracing is Task 7.

## Verified API facts (from spike, not docs)

The published docs disagree with the installed version in two places. These are the *verified* signatures:

- `new PostgresStore({ id: "alta-pg", connectionString })` — **`id` is required**; omitting it throws `MASTRA_STORAGE_PG_INITIALIZATION_FAILED`.
- `workflow.createRun()` returns a **Promise** — there is no `createRunAsync()` on this version.
- `workflow.createRun({ runId })` reattaches to an existing run; `run.resume({ step, resumeData })` then completes it **from a different OS process** (spike-verified against real Postgres).
- `run.start({ inputData })` → `{ status: "suspended" | "success", result }`.
- `createStep({ id, inputSchema, outputSchema, suspendSchema, resumeSchema, execute })`; `execute({ inputData, resumeData, suspend })`; `await suspend({...})` pauses.
- Mastra auto-creates its own `mastra_*` tables on first connect — no migration needed for them.

## Global Constraints

- TypeScript strict, ESM with explicit `.js` import extensions (NodeNext).
- Prisma only via the shared client (`apps/api/src/db.ts`); Zod for all request validation.
- **The propose/execute split is the single most safety-critical invariant.** A PMS mutation or guest-facing send must remain unreachable except after approval (`resumeData.approved === true`) or an explicit `AUTO_APPROVE_INTENTS` match. Any change that weakens this fails review.
- `ORCHESTRATOR=legacy` (default) vs `ORCHESTRATOR=mastra` — both paths ship, so the swap is reversible in one env var. Delete the legacy path only after the Mastra path runs a real pilot.
- The platform must still boot and process messages with **zero API keys** — workflows are deterministic; no step may hard-require an LLM.
- Hand-written Prisma migrations (`prisma migrate deploy`); never `migrate dev`.

## File Structure

```
apps/api/src/modules/mastra/
  instance.ts              (new) Mastra singleton: PostgresStore + registered workflows
  steps/propose.ts         (new) build the draft reply + pending action per department
  steps/reviewGate.ts      (new) suspend()/resume() human gate — the safety boundary
  steps/execute.ts         (new) PMS mutation + ticket + send (post-approval only)
  workflows/intent.ts      (new) createWorkflow: propose → branch(immediate | gate → execute)
  runner.ts                (new) startIntentRun() / resumeIntentRun() — the app-facing API
apps/api/src/modules/orchestrator/index.ts   (modify) route to mastra runner behind the flag
apps/api/src/modules/reviews/reviewOrchestrator.ts (modify) resume the run when present
apps/api/prisma/schema.prisma                (modify) ReviewItem.workflowRunId
apps/api/prisma/migrations/<ts>_review_workflow_run/migration.sql (new)
apps/api/tests/mastraWorkflow.test.ts        (new) the safety invariant, proven
```

---

### Task 1: Mastra instance + Postgres storage

**Files:**
- Create: `apps/api/src/modules/mastra/instance.ts`
- Modify: `.env.example`, `apps/api/.env.example` (`ORCHESTRATOR`)

**Interfaces:**
- Produces: `getMastra(): Mastra` (lazy singleton), `isMastraOrchestrator(): boolean` reading `ORCHESTRATOR === "mastra"`.

- [ ] **Step 1: Create instance.ts**

```ts
import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { intentWorkflow } from "./workflows/intent.js";

let instance: Mastra | undefined;

/** Lazy so importing this module never opens a DB connection at boot —
 *  the legacy orchestrator path must not pay for Mastra it doesn't use. */
export function getMastra(): Mastra {
  instance ??= new Mastra({
    workflows: { intentWorkflow },
    // `id` is required by PostgresStore (verified — omitting it throws).
    storage: new PostgresStore({
      id: "alta-pg",
      connectionString: process.env.DATABASE_URL!,
    }),
  });
  return instance;
}

/** ORCHESTRATOR=mastra routes dispatch through the workflow runtime;
 *  anything else keeps the legacy switch. One env var to roll back. */
export function isMastraOrchestrator(): boolean {
  return process.env.ORCHESTRATOR === "mastra";
}
```

- [ ] **Step 2: Document the flag in both .env.example files**

```
# "mastra" routes intent dispatch through the Mastra workflow runtime
# (durable suspend/resume review gate). Anything else (default) uses the
# legacy dispatch switch. Both paths are equivalent in behavior.
ORCHESTRATOR=legacy
```

- [ ] **Step 3: Commit** (after Task 3 typechecks — instance.ts imports the workflow)

### Task 2: The three steps

**Files:**
- Create: `apps/api/src/modules/mastra/steps/propose.ts`, `reviewGate.ts`, `execute.ts`

**Interfaces:**
- Shared context shape flowing through the workflow:
  `IntentRunInput = { propertyId, guestId, conversationId, intentId, intentType, params: Record<string, unknown>, urgency: "normal"|"urgent", agentKey: string, autoApprove: boolean }`
- Produces: `proposeStep`, `reviewGateStep`, `executeStep`, and `IntentRunResult = { status: "sent"|"queued_for_review"|"rejected", reply?: string }`.

- [ ] **Step 1: propose.ts — read-only draft, no side effects**

Wraps the existing `proposeReceptionReply` / `proposeGuestServiceReply` so agent wording stays in one place. For housekeeping/maintenance there is no proposal (they execute directly), so this step passes them through with `draftReply: null`.

```ts
import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { proposeReceptionReply } from "../../agents/receptionAgent.js";
import { proposeGuestServiceReply } from "../../agents/guestServiceAgent.js";
import { createPMSAdapter } from "../../pms/mockAdapter.js";
import { IntentRunInputSchema, ProposalSchema } from "../schemas.js";

const pms = createPMSAdapter();

/** Read-only: builds the draft reply and the *pending* action. Nothing
 *  here may mutate the PMS or send anything — that is executeStep's job,
 *  and only after the gate. */
export const proposeStep = createStep({
  id: "propose",
  inputSchema: IntentRunInputSchema,
  outputSchema: ProposalSchema,
  execute: async ({ inputData }) => {
    const ctx = {
      guestId: inputData.guestId,
      propertyId: inputData.propertyId,
      intentId: inputData.intentId,
    };
    const intent = { type: inputData.intentType, params: inputData.params, confidence: 1 };

    if (inputData.agentKey === "reception") {
      const p = await proposeReceptionReply(intent as never, ctx, pms);
      return { ...inputData, draftReply: p.draftReply, pendingAction: p.pendingAction };
    }
    if (inputData.agentKey === "guest_service") {
      const p = proposeGuestServiceReply(intent as never, inputData.urgency);
      return { ...inputData, draftReply: p.draftReply, pendingAction: p.pendingAction };
    }
    // housekeeping / maintenance: no guest-facing decision to review
    return { ...inputData, draftReply: null, pendingAction: { type: "no_action", params: {} } };
  },
});
```

- [ ] **Step 2: reviewGate.ts — the safety boundary**

```ts
import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { prisma } from "../../../db.js";
import { emitEvent } from "../../events/bus.js";
import { ProposalSchema, GateOutputSchema } from "../schemas.js";

/**
 * The human-in-the-loop boundary. On first execution there is no
 * resumeData, so it persists a ReviewItem (carrying this run's id) and
 * suspends — the workflow physically stops here. It only continues when
 * staff approval calls resume() with { approved: true }, which is what
 * makes the downstream mutation unreachable without a human decision.
 */
export const reviewGateStep = createStep({
  id: "review-gate",
  inputSchema: ProposalSchema,
  outputSchema: GateOutputSchema,
  suspendSchema: z.object({ draftReply: z.string(), department: z.string() }),
  resumeSchema: z.object({
    approved: z.boolean(),
    editedReply: z.string().optional(),
    reviewedBy: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend, runId }) => {
    if (!resumeData) {
      const item = await prisma.reviewItem.create({
        data: {
          intentId: inputData.intentId,
          department: inputData.agentKey,
          draftReply: inputData.draftReply ?? "",
          pendingAction: JSON.stringify(inputData.pendingAction),
          workflowRunId: runId,
        },
      });
      await emitEvent(inputData.propertyId, {
        type: "review.queued",
        reviewItemId: item.id,
        department: inputData.agentKey,
        intentId: inputData.intentId,
      });
      return await suspend({
        draftReply: inputData.draftReply ?? "",
        department: inputData.agentKey,
      });
    }
    return {
      ...inputData,
      approved: resumeData.approved,
      finalReply: resumeData.editedReply?.trim() || inputData.draftReply || "",
      reviewedBy: resumeData.reviewedBy ?? "unknown",
    };
  },
});
```

Note `runId` is available on the step's execute context — that is what links the DB row back to the suspended run.

- [ ] **Step 3: execute.ts — post-approval only**

Calls the existing `executeReceptionAction` / `executeGuestServiceAction` / `handleHousekeepingIntent`, then sends. Guards on `approved !== false`.

- [ ] **Step 4: Verify no step can mutate before the gate**

Read `propose.ts` and confirm it calls only `propose*` functions (never `execute*`). This is the invariant the test in Task 6 asserts mechanically.

### Task 3: The workflow

**Files:**
- Create: `apps/api/src/modules/mastra/schemas.ts`, `apps/api/src/modules/mastra/workflows/intent.ts`

**Interfaces:**
- Produces: `intentWorkflow` (id `"intentWorkflow"`), composed `propose → reviewGate → execute`.

Low-risk intents must skip the gate. The simplest correct composition (given the verified API) is to keep all three steps in sequence and have `reviewGateStep` short-circuit: if `agentKey` is housekeeping/maintenance **or** `autoApprove` is true, it returns `{approved: true}` immediately instead of suspending. That keeps one linear workflow and one decision site for "does this need a human?", which is easier to audit than a branch.

- [ ] **Step 1: Write schemas.ts** (the Zod shapes named in Task 2)
- [ ] **Step 2: Write intent.ts**

```ts
export const intentWorkflow = createWorkflow({
  id: "intentWorkflow",
  inputSchema: IntentRunInputSchema,
  outputSchema: IntentRunResultSchema,
})
  .then(proposeStep)
  .then(reviewGateStep)
  .then(executeStep)
  .commit();
```

- [ ] **Step 3: Add the short-circuit to reviewGateStep**

At the top of `execute`, before the `!resumeData` branch:

```ts
// Low-risk departments and explicitly graduated intent types never wait
// on a human — same policy as the legacy path's dispatch switch.
const needsHuman =
  (inputData.agentKey === "reception" || inputData.agentKey === "guest_service") &&
  !inputData.autoApprove;
if (!needsHuman) {
  return { ...inputData, approved: true, finalReply: inputData.draftReply ?? "", reviewedBy: "auto" };
}
```

- [ ] **Step 4: Typecheck and commit Tasks 1–3 together**

### Task 4: ReviewItem.workflowRunId

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_review_workflow_run/migration.sql`

- [ ] **Step 1: Add the column (nullable — legacy rows have no run)**

```prisma
  workflowRunId String?  // Mastra run to resume on approval; null for legacy-path rows
```

- [ ] **Step 2: Migration SQL**

```sql
ALTER TABLE "ReviewItem" ADD COLUMN "workflowRunId" TEXT;
```

- [ ] **Step 3: `prisma migrate deploy && prisma generate`, verify column exists, commit**

### Task 5: Wire the runner into orchestrator + review approval

**Files:**
- Create: `apps/api/src/modules/mastra/runner.ts`
- Modify: `apps/api/src/modules/orchestrator/index.ts`, `apps/api/src/modules/reviews/reviewOrchestrator.ts`

**Interfaces:**
- Produces: `startIntentRun(input: IntentRunInput): Promise<DispatchOutcome>`, `resumeIntentRun(runId: string, decision: { approved: boolean; editedReply?: string; reviewedBy?: string }): Promise<void>`.

- [ ] **Step 1: runner.ts**

```ts
export async function startIntentRun(input: IntentRunInput): Promise<DispatchOutcome> {
  const workflow = getMastra().getWorkflow("intentWorkflow");
  const run = await workflow.createRun();
  const res = await run.start({ inputData: input });
  if (res.status === "suspended") {
    return { intentType: input.intentType, status: "queued_for_review" };
  }
  const result = (res as { result?: { reply?: string } }).result;
  return { intentType: input.intentType, status: "sent", reply: result?.reply };
}

export async function resumeIntentRun(runId: string, decision: {...}): Promise<void> {
  const workflow = getMastra().getWorkflow("intentWorkflow");
  const run = await workflow.createRun({ runId });
  await run.resume({ step: reviewGateStep, resumeData: decision });
}
```

- [ ] **Step 2: Orchestrator routes on the flag**

In `dispatchInner`, before the switch:

```ts
if (isMastraOrchestrator()) {
  return startIntentRun({ ...ctx, intentType: intent.type, params: intent.params, urgency, agentKey, autoApprove: AUTO_APPROVE_INTENTS.has(intent.type) });
}
```

- [ ] **Step 3: approveReview / rejectReview resume the run when present**

```ts
if (item.workflowRunId) {
  await resumeIntentRun(item.workflowRunId, { approved: true, editedReply, reviewedBy });
  return markReviewed(id, "approved", reviewedBy); // + emitEvent as today
}
// else: existing legacy execute path, unchanged
```

- [ ] **Step 4: Typecheck, run the full suite under both flag values, commit**

### Task 6: Prove the safety invariant

**Files:**
- Create: `apps/api/tests/mastraWorkflow.test.ts`

- [ ] **Step 1: Write the tests**

Three assertions that would each catch a real regression:

1. A reception intent started through the Mastra runner leaves the workflow **suspended**, creates a `ReviewItem` with a non-null `workflowRunId`, and performs **no** PMS mutation / no outbound message.
2. Resuming with `{approved: false}` completes the run without any mutation.
3. Resuming with `{approved: true, editedReply}` executes exactly once and the edited text is what goes out.

- [ ] **Step 2: Run, confirm all pass, commit**

### Task 7: Langfuse tracing

**Files:**
- Modify: `docker-compose.yml` (langfuse + clickhouse + minio, `profiles: ["observability"]` so a default `up` stays lean)
- Create: `apps/api/src/modules/mastra/tracing.ts`
- Modify: `.env.example` files (`LANGFUSE_*`)

- [ ] **Step 1: Add the Langfuse stack behind an opt-in profile**
- [ ] **Step 2: Instrument the workflow run boundary** — one trace per intent run, spans per step, tagged with `propertyId`/`agentKey`/`intentType`; no-op cleanly when `LANGFUSE_PUBLIC_KEY` is unset (the zero-config boot must keep working).
- [ ] **Step 3: Verify a real trace appears in the Langfuse UI, screenshot it, commit**

### Task 8: Ship

- [ ] **Step 1:** Full suite + typecheck + dashboard build, both flag values.
- [ ] **Step 2:** README section: the workflow runtime, the flag, how the review gate maps to suspend/resume, how to roll back.
- [ ] **Step 3:** Live end-to-end with `ORCHESTRATOR=mastra`: real webhook → suspended run → approve in dashboard → confirm PMS mutation + send happened exactly once.
- [ ] **Step 4:** Branch `feat/mastra-runtime`, push, PR.

---

## Self-Review

- **Spec coverage:** hierarchical/visible agents ✔ (registry from 1A drives `agentKey`; workflow makes each run inspectable), durable HITL ✔ (Tasks 2–5), tracing ✔ (Task 7), reversibility ✔ (flag).
- **Placeholder scan:** Task 2 Step 3 and Task 7 describe rather than show — deliberate: `execute.ts` is a thin wrapper over three existing functions whose signatures live in the agent modules, and the Langfuse wiring depends on which SDK surface the installed version exposes (spike it first, same as Mastra).
- **Type consistency:** `IntentRunInput` flows propose → gate → execute unchanged plus added fields; `workflowRunId` is `String?` in Prisma and `string | null` at every read site; `agentKey` values match `AGENT_REGISTRY` keys exactly.
- **Risk note:** the short-circuit in `reviewGateStep` (Task 3 Step 3) is the single decision site for "does this need a human?" — it is the highest-value line in this plan to review carefully, and Task 6's first test exists to catch it inverting.
