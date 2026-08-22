# ALTA HOST — Master Plan: Full Brief Conformance

**Authority:** `ALTA_Hospitality_AI_Arabic_Developer_Brief.docx` (the governing spec).
**Doctrine:** every phase runs through a preset from `docs/SKILL_DOCTRINE.md`.
**Rulings (owner-approved):** keep Express + add OpenAPI · keep React+Vite · build the real Tenant model.
**Goal:** all 10 acceptance criteria in §11 pass, demonstrably, on a live system that is visual and testable end-to-end.

Current score: **5/10 met, 1 partial, 4 missing.** This plan closes the rest.

---

## Phase map

| # | Phase | Preset | Closes | Size |
|---|---|---|---|---|
| 1 | Tenancy foundation | P4 | §11-1 (structural), §2, §9 | L |
| 2 | Manual AI takeover | P1 | §11-3, §6-ب | S |
| 3 | Roles per the brief | P1+P3 | §3, §11-10 | M |
| 4 | Object storage + quotas | P1+P8 | §11-8, §5 | L |
| 5 | Work orders + technicians | P1+P2 | §11-5, §6-ج | L |
| 6 | Knowledge base + agent policies | P9 | §7, §4 (مركز الوكلاء) | L |
| 7 | Google reviews | P1+P7 | §11-6, §6-د | L |
| 8 | Social content studio | P7+P1 | §11-7, §6-هـ | XL |
| 9 | OpenAPI + handover pack | P5 | §14 | M |
| 10 | Acceptance run + pilot readiness | P3+P6 | §11 full pass, §12-6 | M |

Order is dependency-driven: tenancy first because everything after it writes tenant-scoped rows; storage before
work orders and content because both need files; knowledge/policies before reviews and social because both
agents are policy-governed (§7).

---

## Phase 1 — Tenancy foundation (P4 SAAS-FOUNDATION)

**Why first:** §10 mandates `tenant_id` in every business table; §2 gives each hotel its own account, plan,
quota, users. Retrofitting later multiplies cost across every subsequent phase.

**Schema**
- `Tenant { id, name, plan (basic|pro|enterprise), status (active|suspended), timezone, language, quotaGb, usedBytes, createdAt }`
- `Property.tenantId` (a tenant may own several properties — hotel groups are the real customer per §1)
- `tenantId` denormalised onto every business table: Guest, Conversation, Message, Intent, Ticket, ReviewItem,
  AltaEvent, AuditEvent, PropertyCredential, StaffMember + all new tables in later phases
- Backfill migration: create one Tenant per existing Property, copy ids, then set NOT NULL

**Enforcement (the part that makes §11-1 structural, not conventional)**
- `requireAuth` resolves `tenantId` into `req.staff`; JWT carries it
- A Prisma client extension appends `tenantId` to every query on business models — isolation by construction;
  a forgotten `where` clause fails closed, not open
- Cross-tenant test: two tenants seeded, every API endpoint probed with the wrong tenant's token, expect 404/403 on all

**Acceptance evidence:** the §11-1 probe suite green; verify-tenant-isolation script extended to tenant level.

---

## Phase 2 — Manual AI takeover (P1 SHIP-VERIFIED)

**Why now:** hard acceptance gate (§11-3), small, and touches the conversation model Phase 5+ builds on.

- `Conversation.aiPaused Boolean @default(false)`, `takenOverBy`, `takenOverAt`
- Orchestrator/worker check `aiPaused` **before dispatch and before any send** — a queued job for a
  conversation taken over mid-flight must not reply (§6-ب: "يتوقف أي رد تلقائي فورًا")
- `POST /conversations/:id/takeover` (any staff), `POST /conversations/:id/resume-ai` (manager only — §6-ب
  says only an authorised manager returns it to AI)
- `POST /conversations/:id/reply` — manual staff reply through the same gateway
- Events: `conversation.takenover` / `conversation.resumed` → Ops Center shows a "human holding" state
- Dashboard: inbox view (§4 صندوق رسائل النزلاء) — conversation list, guest panel, AI-suggestion pane,
  the «استلام المحادثة» button, timeline
- **Test that matters:** message arrives → AI drafts → staff takes over → second message arrives → AI stays
  silent → manager resumes → AI answers again. Automated + live.

---

## Phase 3 — Roles per the brief (P1 + P3)

§3 defines seven roles; we have five, two of which (housekeeping/guest_service) are departments mislabeled as roles.

- Role enum: `alta_admin, hotel_manager, reception, maintenance_manager, technician, marketing_manager, general_manager`
- Migration maps existing: manager→hotel_manager, maintenance→maintenance_manager; housekeeping/guest_service
  staff become department assignments, not login roles
- Central `can(role, action)` policy table — one file, exhaustive, tested; API-side enforcement only (§11-10)
- `alta_admin` is cross-tenant but **cannot export guest data** (§3 explicitly) — needs its own audit action
- Platform-admin screens: create hotel, set plan/quota, suspend — the §13 onboarding path
- Route guards per §4's screen list (technicians see only their own work orders, etc.)

---

## Phase 4 — Object storage + quotas (P1 + P8 OPS-RELIABILITY)

§5 in full. MinIO (S3-compatible, self-hosted — consistent with data-residency posture) in docker-compose.

- `StorageFile { id, tenantId, propertyId, kind (fault_photo|content_media|post_image|policy_doc|ticket_attachment), path, sizeBytes, mime, ownerId, status (active|trashed|deleted), trashedAt, createdAt }`
- Path scheme exactly as §5: `{hotel}/{kind}/{year}/{month}/{file}`
- Upload via presigned PUT; downloads via short-lived signed GET — **nothing public** (§5 الحماية)
- Quota: `Tenant.quotaGb/usedBytes` maintained transactionally on upload/delete; alert event at 80%
  (§11-8), hard block + upgrade prompt at 100%
- Trash: soft-delete, 30-day sweep job (BullMQ repeatable) then hard delete (§5 الحذف)
- MIME allow-list + size caps + magic-byte sniff (§10 فحص الملفات)
- Dashboard: storage meter in settings, per-kind usage bars, trash view with restore
- **Test:** upload to 79% → no alert; cross 80% → alert event; hit 100% → upload rejected 507; trash → restore →
  hard-delete after sweep; signed URL expires and then 403s.

---

## Phase 5 — Work orders + technicians (P1 + P2 DESIGN-GOD)

§6-ج and §11-5. Work orders are not tickets renamed — they carry assignment, checklists, photo evidence,
and a manager-gated close for critical faults.

- `WorkOrder { id, tenantId, propertyId, ticketId?, title, category, priority (critical|high|normal|low), status (new|assigned|in_progress|awaiting_confirm|closed), assigneeId, location, checklist Json, createdBy, closedBy, createdAt }`
- `WorkOrderUpdate { workOrderId, authorId, note, photoFileIds[] , createdAt }` — photos via Phase 4 storage
- Critical flow: creation at `critical` → immediate escalation event + notification to maintenance_manager
  and the escalation list (§6-ج); **closing a critical WO requires maintenance_manager confirm** — enforced
  in the API, tested
- Technician mobile-first screens (P2 + Mobile Design): my orders only, status update, note + camera upload,
  before/after photos (§4 لوحة الصيانة)
- Maintenance-manager board: assign, prioritise, approve closes
- Audit: every state change through the tamper-evident trail
- **Acceptance evidence (§11-5):** technician logs in on a phone viewport, adds a photo, updates status — recorded live.

---

## Phase 6 — Knowledge base + agent policies (P9 AGENT-FORGE)

§7 is a table of allowed/forbidden per agent; today it is prose. This phase makes it enforced data.

- `KnowledgeItem { id, tenantId, propertyId, title, contentAr, contentEn, tags[], status (draft|approved|retired), approvedBy, updatedAt }` —
  agents may answer **only from approved items** (§6-أ: "إذا كانت الإجابة في المعرفة المعتمدة")
- `AgentPolicy { tenantId, propertyId, agentKey, enabled Boolean, config Json }` — the on/off per agent
  (§4 مركز الوكلاء: تشغيل/إيقاف الوكيل)
- Guest-service agent answers FAQs from knowledge matches; no match → create request + suggest department
  (§6-أ) — replaces the hardcoded FAQ strings in receptionAgent
- Forbidden-action guards as code: no policy invention, no booking mutation without gate, no financial
  compensation, no cross-guest data (§7 row 1) — each with a test that attempts the forbidden thing
- Agent Centre screen upgrade: per-agent toggle, policy view, knowledge tab, run log (the registry + events
  already provide the run log)
- `AgentRun` capture per §9: inputs, outputs, tools, policy applied, time
- **Test:** disable guest-service agent → inbound FAQ gets no AI draft, goes straight to staff; approved
  knowledge item answers; retired item stops answering.

---

## Phase 7 — Google Business Profile reviews (P1 + P7)

§6-د and §11-6. OAuth + fetch + classify + draft + approve; **no auto-publish in v1** (explicit in §7).

- `SocialAccount { id, tenantId, propertyId, platform (google|instagram|facebook|tiktok), accountRef, status, encryptedToken → PropertyCredential, expiresAt }` — tokens live in the existing vault (§8: encrypted, never shown)
- `GoogleReview { id, tenantId, propertyId, externalId, stars, text, author, sentiment, topic, draftReply, replyStatus (none|draft|approved|published), approvedBy, publishedAt }`
- Poll job (BullMQ repeatable) fetches new reviews; classifier sets sentiment/topic; drafts AR/EN reply
- Negative or safety-related review → immediate alert event (§6-د)
- Reputation screen (§4): stars average, list, classification chips, draft editor, approve → publish
- Dev mode: a mock Google provider behind the same interface so the whole flow is testable without OAuth
  approval wait; real OAuth wiring documented for onboarding
- **Acceptance evidence (§11-6):** link account (mock or real), reviews fetched, reply drafted, approved, publish recorded.

---

## Phase 8 — Social content studio (P7 GROWTH-ENGINE + P1)

§6-هـ and §11-7. The largest module; the brief's own plan gives it 3 weeks.

- `ContentItem { id, tenantId, propertyId, idea, bodyAr, bodyEn, mediaFileIds[], channel (instagram|facebook|tiktok), status (idea|draft|in_review|approved|scheduled|published|failed|rejected), approvedBy, scheduledAt, publishedAt, resultUrl, metrics Json }`
- Brand profile per property: identity, services, offers, audience, language (§6-هـ step 1)
- Generation: monthly plan → ideas → drafts (text; image/video generation behind the metered AI-generator
  service interface of §8 — pluggable, usage-metered per hotel)
- Approval workflow: review → edit/reject/approve; **publish only after approval** (§7)
- Scheduler: BullMQ delayed jobs publish at `scheduledAt` to connected accounts via a unified platform
  adapter layer (§8: Instagram/Facebook first, TikTok draft-mode, others when approved) — with a mock
  publisher for dev/test and failure → alert + retry
- Content studio screen (§4): monthly calendar, idea board, editor with media picker (Phase 4 storage),
  approval states, publish status + result link
- **Acceptance evidence (§11-7):** one account linked (mock in dev), content created → approved → scheduled →
  publish result recorded with link.

---

## Phase 9 — OpenAPI + handover pack (P5 API-CONTRACT)

§14 deliverables, minus rewriting the stack (per ruling).

- OpenAPI 3 spec generated from the Zod schemas (zod-openapi), served at `/api/docs` (Swagger UI)
- Typed client generation check in CI (spec drift fails the build)
- Postman/Insomnia collection exported from the spec
- Runbook: create hotel, link WhatsApp, Google, social, storage/users management (§14-5)
- Deploy guide + env template without secrets (§14-6); staging/production compose profiles (§14-7)
- Backup/restore procedure documented **and rehearsed once** (§5, §14-8)

---

## Phase 10 — Acceptance run + pilot readiness (P3 FORTRESS + P6 QA-MAX)

- The **§11 acceptance suite**: one automated run per criterion, each producing evidence (screenshot,
  DB assertion, or timing measurement), plus a live walkthrough script in Arabic for UAT (§13)
- P3 security pass: vulnerability sweep, authn probes, rate-limit verification, file-upload abuse tests
- Load re-run at scale with the new modules (the 28.5 msg/s baseline must not regress past 20)
- Pilot onboarding checklist per §13: hotel setup, SLA config, staff, knowledge, channel linking, training notes
- 30-day warranty issue-tracking board (§14-10)

---

## Acceptance matrix — the definition of done

| §11 | Criterion | Phase | Proof artifact |
|---|---|---|---|
| 1 | No cross-hotel access, UI **and API** | 1,3 | Cross-tenant probe suite, green |
| 2 | WhatsApp message visible ≤ 10s | done | SSE latency measurement (sub-second) |
| 3 | AI stops on takeover, immediately | 2 | Takeover race test + live demo |
| 4 | SLA/status/escalation correct | done | Existing FR-10 suite |
| 5 | Technician photo + status update | 4,5 | Mobile-viewport live recording |
| 6 | Google linked, reviews fetched, reply approved | 7 | Flow evidence (mock + real path) |
| 7 | Social account, content → approve → schedule → result | 8 | Flow evidence |
| 8 | Storage accurate, 80% alert | 4 | Quota crossing test |
| 9 | Every action logged with time + actor | done (extend) | Hash-chain verify + coverage list |
| 10 | Permissions in API, not just UI | 3 | Per-role endpoint matrix test |

---

## Honest sizing

Solo-agent execution, verified at each step (no phase ships without its acceptance evidence):
Phases 1–3 are days each. Phase 4–7 are each multi-day. Phase 8 is the largest single block.
The brief's own §12 budget for the equivalent remaining scope (its phases 4–6) is **7 weeks of solo
developer time**. Momentum here has been running far faster than that, but I will not promise a date —
each phase lands as a verified PR, and the acceptance matrix is the only "done" that counts.
