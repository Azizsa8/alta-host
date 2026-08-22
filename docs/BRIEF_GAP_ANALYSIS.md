# ALTA Hospitality AI — Brief Conformance & Gap Analysis

Source of authority: `ALTA_Hospitality_AI_Arabic_Developer_Brief.docx`.

That document states it is the implementation and acceptance reference, and that
no function, integration, or permission may be added, removed, or changed
without the product owner's approval. This file records where the current build
stands against it, and isolates the decisions that are the owner's to make
rather than mine.

Assessed against `main` as of 2026-08-21.

---

## 1. Acceptance criteria (§11) — the definition of done

| # | Criterion | Status | Evidence / gap |
|---|---|---|---|
| 1 | No hotel can see or modify another hotel's data, via UI **or API** | **Partial** | Every business query scopes by `propertyId` and permissions are enforced in the API, not just the UI. But there is no `Tenant` entity and no mandatory `tenant_id` column as §10 requires — isolation is by convention per query, not structurally guaranteed. |
| 2 | A new WhatsApp message appears in the hotel's inbox within 10 seconds | **Met** | SSE live feed delivers sub-second; measured webhook ack p50 72ms under 40-way concurrency. |
| 3 | AI replies stop immediately on manual takeover | **Missing** | No `ai_paused` flag, no takeover action. §6-ب specifies the whole flow. This is a hard acceptance gate. |
| 4 | SLA, status and escalation display correctly per request | **Met** | FR-10 SLA deadlines per department × urgency, auto-escalation, visible on the ticket board. |
| 5 | A technician can add a photo and update work-order status | **Missing** | No technician role, no work orders, no file upload at all. |
| 6 | Google page can be linked, reviews fetched, reply drafted for approval | **Missing** | A `Review` table exists but there is no Google Business Profile integration. |
| 7 | At least one social account linked; content created, approved, scheduled, publish result recorded | **Missing** | Entire module absent. |
| 8 | Storage usage calculated accurately, alert at 80% of quota | **Missing** | No object storage, no quota model. |
| 9 | Every user and agent action stored with time and actor | **Met** | Tamper-evident audit trail (hash-chained, verifiable via `/api/audit/verify`). Coverage currently: logins, review decisions, credential operations. Needs extending to ticket and work-order actions. |
| 10 | Permissions enforced in the API, not only the UI | **Met** | `requireAuth` on the whole API router; role checks server-side (e.g. credentials are manager-only). |

**5 of 10 met. 4 missing outright, 1 partial.**

---

## 2. Modules required by the brief

| Module (§2) | Status |
|---|---|
| Hotel operations dashboard — guests, conversations, requests, maintenance | Partial — guests, conversations, tickets exist; maintenance is a ticket department, not work orders |
| WhatsApp Business link, approved replies | **Met** — Cloud API gateway built; WAHA is dev/demo only |
| Policy-governed AI agents with full audit log | Partial — agents + audit exist; **no policy engine, no on/off switch, no approved-knowledge base** |
| Google Maps review management | **Missing** |
| Social content: plan, create, approve, schedule | **Missing** |
| Secure storage for images, videos, maintenance attachments | **Missing** |
| Executive dashboard, daily reports, critical alerts | Partial — daily report exists; no critical-alert channel |

---

## 3. Stack conflicts — owner decision required

The brief specifies a stack (§10) that differs from what is built and working.

| Layer | Brief requires | Currently built | Assessment |
|---|---|---|---|
| Frontend | **Next.js** / React / TS, RTL, protected routes, responsive | **React + Vite** / TS, RTL, protected routes, responsive | Meets every stated *behaviour*. Next.js would add SSR/routing we do not currently need. Migration cost: moderate. |
| Backend | **NestJS or FastAPI**, Swagger/OpenAPI, service architecture | **Express** + TypeScript, modular services, no OpenAPI doc | Meets the architecture intent; **fails the letter**, and genuinely fails on Swagger/OpenAPI, which §14 lists as a deliverable. Rewriting to NestJS is weeks of work that changes no user-visible behaviour and risks regressing 100 passing tests. |
| Database | PostgreSQL, **`tenant_id` mandatory in every business table** | PostgreSQL, `propertyId` on business tables, no Tenant entity | Naming differs and the tenancy layer above "property" is absent. This one I consider a real defect, not a cosmetic difference — §2 requires each hotel to have its own account, users, plan and quota. |
| Queues | Redis + workers | BullMQ + Redis, measured 28.5 msg/s | **Met** |
| Storage | S3-compatible, signed URLs, encryption, backup | **None** | **Missing entirely** |
| Security | TLS, encryption, RBAC, rate limit, input validation, **file scanning**, audit log | TLS, AES-256-GCM credential vault, partial RBAC, rate limits, Zod validation, audit trail | File scanning missing (no files yet); RBAC needs the fuller role set |

### The three questions only the owner can answer

1. **Backend framework.** Rewrite Express → NestJS to match the letter of §10, or keep Express and satisfy the intent by adding OpenAPI/Swagger documentation (§14 deliverable)? My recommendation: keep Express, add OpenAPI. The rewrite buys no capability the brief actually asks for, and the brief's own acceptance criteria are all behavioural.
2. **Frontend framework.** Migrate React+Vite → Next.js, or keep Vite? Recommendation: keep Vite unless SSR/SEO is wanted for a public marketing surface; the dashboard is authenticated and behind a login.
3. **Tenancy model.** Introduce a proper `Tenant` entity with plan, quota and status (per §2 and §9), with `tenantId` on every business table? Recommendation: **yes** — this is the one structural gap I would not paper over, because §11-1 acceptance depends on it and retrofitting tenancy later is far more expensive than doing it now.

---

## 4. Roles: brief vs. built

| Brief role (§3) | Built |
|---|---|
| ALTA platform admin | **Missing** |
| Hotel manager | `manager` |
| Reception | `reception` |
| Maintenance manager | Partial — `maintenance` exists but without manager/technician split |
| Technician | **Missing** |
| Marketing manager | **Missing** |
| General manager | **Missing** |

`housekeeping` and `guest_service` exist in the build but are not named roles in §3 — they map to departments rather than user roles. Needs reconciling.

---

## 5. What is built that the brief does not ask for

Recorded for transparency, since the brief forbids unapproved additions:

- **Operations Center** (live agent fleet graph + incident replay). Not requested. It does serve §4's "مركز الوكلاء" (agent centre) partially and was built at the owner's explicit spoken request.
- **Mastra workflow runtime** with durable suspend/resume. An implementation choice, not a feature; it enforces §7's rule that agents may not act without human approval.
- **Sub-agent hierarchy.** Built at the owner's explicit request; makes agent reasoning inspectable.
- **Tamper-evident audit chain.** §9 requires an audit log; hash-chaining exceeds the requirement.

None of these conflict with the brief. Flagging them so the owner can confirm or strike them.

---

## 6. Recommended sequence

Ordered by acceptance-gate value, not by ease:

1. **Tenancy model** — `Tenant`, plan, quota, `tenantId` everywhere. Unblocks §11-1 properly and is cheapest now.
2. **Manual takeover (`ai_paused`)** — §11-3, a hard gate, and small.
3. **Object storage + quotas** — §11-8 and prerequisite for work-order photos and content.
4. **Work orders + technician role** — §11-5.
5. **Knowledge base + agent policies/on-off** — §7 governs every agent; currently unenforced.
6. **Google reviews** — §11-6.
7. **Social content studio** — §11-7, the largest module.
8. **OpenAPI/Swagger + handover pack** — §14 deliverables.

Phases 1–4 of the brief's own plan (§12) are largely covered by what exists; the unbuilt weight is phases 4–5 (storage, reputation, marketing).
