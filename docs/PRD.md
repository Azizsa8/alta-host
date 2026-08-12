# ALTA — Product Requirements Document

| | |
|---|---|
| **Status** | Draft v1 — engineering spec, Phase 1 (MVP) |
| **Derived from** | `Product Requirements Document (PRD)_ ALTA AI Unified Hospitality Platform.pdf`, `Implementation Blueprint_...pdf`, `The ALTA AI Workflow_...pdf` (repo root) |
| **Owner** | Engineering |
| **Scope of this document** | Phase 1 in full detail; Phase 2/3 named but not specified — see [§12](#12-out-of-scope) |

---

## 1. Problem Statement

Independent and mid-sized Saudi hotels (50–250 rooms — "the Forgotten Middle") have the budget
for software but not the IT headcount to run an enterprise stack. Guest requests arrive across
phone, walk-up, and informal channels; nothing connects the PMS, front desk, and housekeeping,
so requests get lost, response times are slow, and Hajj/Umrah season volume spikes break the
model entirely. The fix is not another dashboard — it's removing the humans from the routing
path for routine requests, while keeping a human in the loop wherever a mistake would reach the
guest or touch billing.

## 2. Goals

| Goal | Metric | Source |
|---|---|---|
| Zero missed guest requests | 100% of inbound messages produce a logged intent + ticket or reply | PRD §3 |
| Fast acknowledgement | Guest gets a response (auto-reply or "reviewing") in <10s | Blueprint §5 |
| Routine requests need no human routing | 90%+ of housekeeping/maintenance requests ticketed without staff creating the ticket manually | Blueprint §5 |
| Nothing guest-facing ships unreviewed during pilot | 100% of reception/guest-service replies pass through the review queue in Days 31–60 | Blueprint §4 |
| Management sees a recommendation, not a report | Daily report surfaces at least one actionable flag when ticket patterns warrant it | PRD §6, Workflow §5 |

### Non-goals (Phase 1)

- Autonomous guest-facing replies for booking/complaint intents (that's the Days 61–90 graduation, config-gated — see §7.6)
- Real WhatsApp Business API delivery (interface is built; no live token in Phase 1 dev)
- Real PMS vendor integration (Oracle/Mews) — interface is built against a mock
- Digital Reputation Agent, Marketing & Sales Agent, dynamic pricing — Phase 2/3

## 3. Personas

| Persona | Needs |
|---|---|
| **Guest** | Ask for something in their own dialect via WhatsApp, get an answer fast, never repeat themselves |
| **Reception / Guest Service staff** | See AI-drafted replies before they reach a guest during the pilot window; approve or fix in seconds |
| **Housekeeping / Maintenance staff** | Get a ticket the moment a guest asks — no phone call from the front desk |
| **General Manager** | One place to see what's open, what's urgent, and what needs a decision — not a chart to interpret |

## 4. System Overview

Six-layer architecture (full detail in the architecture doc from the prior working session):
Guest Interface → Intelligence (NLU) → Agent Orchestration → PMS Integration → Data Platform →
Command Center. This PRD specifies the **behavior** of each layer for Phase 1; the existing
codebase (`apps/api`, `apps/dashboard`) is the reference implementation and is kept in sync with
this document.

## 5. Scope — Phase 1 (MVP)

In scope: WhatsApp-shaped message ingestion, multi-intent extraction, Reception / Guest Service /
Housekeeping & Maintenance agents, PMS adapter interface (mock), ticket routing to on-shift staff,
a human review queue for guest-facing replies, and an Executive daily report. Out of scope is
listed in §12.

## 6. Functional Requirements

### FR-1 — Guest message ingestion

The system accepts an inbound guest message (text; voice-note transcription is a later input to
the same contract) tied to a `propertyId` and a guest `whatsappId`. A guest is created on first
contact; all messages from the same `whatsappId` join the same guest's conversation history.

**Acceptance criteria**
- Given a `whatsappId` that has never messaged this property, when a message arrives, then a new `Guest` and `Conversation` are created.
- Given a `whatsappId` that has messaged before, when a message arrives, then it's appended to the existing conversation, not a new one.
- The real WhatsApp Cloud API webhook payload shape is accepted and normalized to the same internal contract as the local simulator endpoint — one code path, two entry points.

### FR-2 — Multi-intent extraction

A single message may contain more than one actionable request. Each is extracted independently
with a type, parameters, and a confidence score; the message also gets one sentiment and one
urgency classification.

**Acceptance criteria**
- Given "I need a room cleaning and a two-hour late check-out", when processed, then two intents are extracted: `housekeeping.clean_room` and `booking.extend_stay` with `{hours: 2}`.
- Given a message with no recognizable intent, when processed, then zero intents are extracted and the guest gets a generic acknowledgement — the message is never silently dropped.
- Given language markers of anger or urgency ("unacceptable", "urgent", "!!!" or Arabic equivalents), when processed, then `urgency: "urgent"` is set regardless of which intent(s) were found.

### FR-3 — Reception Agent (`booking.extend_stay`, `reception.faq`)

Validates against the PMS adapter (reservation lookup, billing status) and drafts a reply.
**Requires human review before sending** (§7).

**Acceptance criteria**
- Given a guest with no active reservation, when `extend_stay` is processed, then the draft reply asks for room confirmation instead of proposing an extension.
- Given a guest with an active reservation and a valid payment method on file, when `extend_stay` is processed, then the draft reply proposes the new checkout time and the pending action captures `{reservationId, hours}` for execution on approval — the PMS is not mutated until approval.

### FR-4 — Guest Service Agent (`guest_service.complaint`)

Drafts an empathetic reply, distinguishing urgent/negative cases. **Requires human review before
sending.**

**Acceptance criteria**
- Given `urgency: urgent`, when a complaint is processed, then the draft reply references escalation to a duty manager, and the review-queue item is flagged/sorted as urgent.

### FR-5 — Housekeeping & Maintenance Agent (`housekeeping.clean_room`, `maintenance.report_issue`)

No guest-facing risk — creates a ticket and sends the reply **immediately**, no review step.

**Acceptance criteria**
- Given a `clean_room` intent, when processed, then a ticket is created, routed to an on-shift `housekeeping` staff member if one exists, and a confirmation is sent to the guest with no review delay.
- Given no on-shift staff for the department, when a ticket is created, then it's still created (unassigned) rather than dropped, and this is visible on the ticket.

### FR-6 — Human Review Queue

Reception and Guest Service replies land in a review queue instead of being sent. A staff member
can approve as-is, edit the text then approve, or reject.

**Acceptance criteria**
- Given a pending review item, when a staff member approves it unedited, then the drafted reply is sent to the guest and the pending action (e.g. PMS checkout extension, ticket creation) executes exactly once.
- Given a pending review item, when a staff member edits the reply text and approves, then the **edited** text is sent, not the original draft.
- Given a pending review item, when a staff member rejects it, then nothing is sent to the guest and no PMS mutation occurs; the rejection is logged.
- Given an intent type listed in the auto-approve configuration (§7.6), when that intent is processed, then it skips the review queue and behaves like FR-5.

### FR-7 — Ticket Board

Every ticket traces back to the message and intent that created it, shows assigned staff, and
supports status transitions (open → in progress → done).

### FR-8 — Executive Daily Report

Aggregates tickets and intents into department counts, urgency/sentiment breakdown, and generates
plain-language recommendations when a pattern crosses a threshold (mirrors the PRD's own example:
repeated AC complaints → maintenance recommendation).

**Acceptance criteria**
- Given 2 or more maintenance tickets whose description mentions the same keyword (e.g. "AC" / "مكيف"), when the report is generated, then it includes a recommendation naming that pattern — not just a count.
- Given zero tickets in the reporting window, when the report is generated, then it returns zero-value metrics and no recommendations, not an error.
- Given one or more tickets with `escalatedAt` set (FR-10), when the report is generated, then it includes an escalation summary (count, scoped to the requesting `propertyId`) so management sees SLA breaches without cross-referencing the Ticket Board.

### FR-9 — Guest Consent Capture (first WhatsApp contact)

WhatsApp-first means the first inbound message from a new `whatsappId` is also the first moment
ALTA can capture consent for processing and storing that guest's message content, per Saudi PDPL
(§7.7). Consent capture is inline with the FR-1 guest/conversation creation flow — it does not gate
the auto-acknowledgement, but it must be recorded before any agent processes the message content
beyond the initial log-and-acknowledge step.

**Acceptance criteria**
- Given a `whatsappId` that has never messaged this property, when the new `Guest` and `Conversation` are created (FR-1), then a consent record is created alongside them, and the guest's acknowledgement includes a brief, plain-language PDPL notice (what data is stored, why, and how to opt out) in the guest's message language.
- Given a `whatsappId` with no recorded consent, when a Reception or Guest Service agent (FR-3, FR-4) would draft a reply referencing stored guest or reservation data, then processing still proceeds — consent is not a hard gate on Phase 1 functionality — but the missing-consent state is visible on the guest record for staff and for the Executive Daily Report (FR-8).
- Given a guest who has previously messaged and already has a recorded consent, when a new message arrives, then no duplicate consent record or notice is created.
- Given a guest who replies with an opt-out keyword (e.g. "STOP" / "توقف"), when processed, then the guest's consent status is set to withdrawn and this transition is logged to `AgentAction` (§7.4) for audit.

### FR-10 — Ticket SLA Deadlines & Escalation

Every ticket is guest- or property-impacting work with an implicit time expectation that today
exists only as a cosmetic, hardcoded age indicator on the dashboard (30 min / 2 h thresholds,
identical for every department and urgency, with no connection to either —
`apps/dashboard/src/pages/TicketBoard.tsx`). This FR makes that expectation real: an SLA deadline
is computed at ticket creation from `department` + the parent intent's `urgency`, and a ticket that
is still `open` (never moved to `in_progress` or `done`) past that deadline is flagged as escalated
— surfaced on the Ticket Board (FR-7) and rolled into the Executive Daily Report (FR-8) so
management sees it, not just front-line staff scrolling past a stale card.

**Default SLA windows** (minutes from ticket creation; department × urgency, per FR-2's existing
`urgency: normal | urgent` classification):

| Department | Urgent | Normal |
|---|---|---|
| `guest_service` | 15 min | 60 min |
| `reception` | 15 min | 60 min |
| `housekeeping` | 30 min | 120 min |
| `maintenance` | 30 min | 240 min |

Reasoning: guest-facing departments (`reception`, `guest_service`) get the tightest windows at both
urgency tiers, because a slow reply here is directly guest-visible — this mirrors FR-4's existing
promise that an urgent complaint's *drafted reply* already references escalation to a duty manager;
the SLA makes that promise operationally enforceable on the ticket itself, not just in the reply
text. Urgent tickets across every department get a 15–30 min window, consistent with FR-2's urgency
signal being reserved for language markers of real anger or urgency ("unacceptable", "!!!" or
Arabic equivalents) — if a message triggered that classification, a slow ticket response defeats the
purpose of extracting it. Normal-urgency back-of-house work (`housekeeping`, `maintenance`) gets the
longest windows (2–4 h) because it's operationally visible but not guest-facing until it affects room
readiness; these numbers extend, rather than replace, the dashboard's pre-existing 30 min / 2 h
cosmetic thresholds, with `maintenance` given a longer normal-tier window than `housekeeping` since
routine maintenance historically tolerates a longer queue than a guest waiting on a room clean.
These are Phase 1 defaults, not a claim of validated operational thresholds — real numbers get
tuned against Phase 2 pilot data per `docs/PROJECT_PLAN.md` §3's human-in-the-loop pilot phase.

Escalation state is **persisted, not recomputed on every read**: the first time a ticket is observed
still `open` past its `slaDeadline`, `escalatedAt` is set once. This is a deliberate design
constraint, not an implementation detail left open — without it, "escalated" would flicker
true/false/true on every poll, and any downstream notification (Executive Report, on-duty staff
alert) would refire repeatedly for the same breach instead of once per ticket.

**Acceptance criteria**
- Given a ticket created for `department: guest_service` with parent intent `urgency: urgent`, when the ticket is created, then `slaDeadline` is set to `createdAt + 15 minutes` (and analogously for every other department/urgency pair in the table above).
- Given an `open` ticket whose `slaDeadline` has passed, when the escalation check runs (on read or on a periodic sweep — mechanism is an implementation choice), then `escalatedAt` is set and the ticket is flagged as escalated on the Ticket Board and counted in the Executive Daily Report's escalation summary (FR-8).
- Given a ticket that already has `escalatedAt` set, when the escalation check runs again while the ticket is still `open`, then `escalatedAt` is **not** overwritten and no duplicate escalation event/notification fires — escalation is a one-time transition per ticket, not a recurring flag.
- Given a ticket moved to `done` (matches the existing dashboard rule that `done` tickets never show a stale/age warning regardless of age), when the escalation check runs, then it is never flagged as escalated for display purposes, even if `slaDeadline` has long passed and even if `escalatedAt` was already set before it reached `done`.
- Given a ticket moved to `in_progress` before its `slaDeadline`, when the escalation check runs, then it is not escalated — matches FR-7's existing status model: only `open` tickets accrue SLA risk.

**Multi-tenant scoping**: `Ticket` has no direct `propertyId` column today (§8) — it's scoped
transitively through `intent → message → conversation → guest → propertyId`, the same relation
chain `/api/metrics` and `/api/tickets` already use. `slaDeadline` and `escalatedAt` are plain
columns on the existing `Ticket` row, so per-property ticket queries that already filter this way
inherit the scoping automatically. But any **new** aggregate this FR introduces — an
escalated-ticket count on `/api/metrics`, an escalation section in `/api/reports/daily` (FR-8) —
MUST thread `propertyId` through that same relation chain explicitly, the way `/api/metrics`'
`openTickets`/`totalTickets` do today. This is not optional: this session already found and fixed
exactly this class of bug (`urgentIntents` in `apps/api/src/modules/api/routes.ts` was counting
intents by `urgency` alone without the `propertyId` filter applied to every other metric in the
same handler, until it was corrected — see `apps/api/scripts/verify-tenant-isolation.ts`). Any
new escalation-related query is held to NFR 7.3 and reviewed the same way.

## 7. Non-Functional Requirements

| # | Requirement |
|---|---|
| 7.1 | Every inbound message produces a persisted record even if intent extraction finds nothing (no silent drops) |
| 7.2 | PMS mutations only occur inside an approved action (review queue) or an auto-approved low-risk agent (FR-5) — never during intent extraction or drafting |
| 7.3 | Multi-tenant by `propertyId` at the query layer from Phase 1, even with one pilot property seeded |
| 7.4 | All agent actions (ticket creation, PMS calls, review decisions) are logged to `AgentAction` for audit |
| 7.5 | The webhook accepts the real WhatsApp Cloud API payload shape today, even though no token is configured in dev |
| 7.6 | `AUTO_APPROVE_INTENTS` (env, comma-separated intent types) lets specific intent types skip the review queue — the mechanism for the Days 61–90 autonomy graduation, unused (empty) by default |
| 7.7 | Guest message content and any PII collected via WhatsApp are processed and stored in a way that satisfies Saudi PDPL (Personal Data Protection Law) — in-Kingdom hosting, or an equivalent compliant path. If intent extraction or drafting comes to call an LLM, that call is routed through a self-hosted, in-Kingdom-hostable inference layer (e.g. LocalAI — see `docs/OSS_OPTIONS.md`'s Layer 03/04 entry) rather than a third-party hosted API, to avoid guest message content leaving the property's infrastructure. Data residency and processing-location decisions are confirmed before Phase 2 pilot deployment, not retrofitted after launch (matches `docs/PROJECT_PLAN.md` §1 principle 4 and its §5 risk register entry "PDPL / data residency misstep") |

## 8. Data Model

Existing Prisma schema (`apps/api/prisma/schema.prisma`) plus these additions/extensions this PRD
requires:

**`ReviewItem`** (new) — `id, intentId (unique), department, draftReply, pendingAction (JSON), status (pending|approved|rejected), reviewedBy?, createdAt, reviewedAt?`

**`ConsentRecord`** (new, FR-9 / §7.7) — `id, guestId (unique), status (granted|withdrawn), capturedAt, withdrawnAt?, noticeLanguage`

**`Ticket`** (existing, extended by FR-10) — adds `slaDeadline (DateTime, set at creation), escalatedAt (DateTime?, set once when an open ticket passes slaDeadline)`. No new `propertyId` column — scoping remains transitive via `intent → message → conversation → guest → propertyId`, unchanged from today.

All other entities (`Property, Guest, Reservation, StaffMember, Conversation, Message, Intent,
AgentAction, Review`) are unchanged from the existing implementation.

## 9. API Contract

| Method | Path | Purpose |
|---|---|---|
| POST | `/webhook/whatsapp` | Real WhatsApp Cloud API inbound webhook |
| GET | `/webhook/whatsapp` | WhatsApp verification handshake |
| POST | `/api/simulate` | Local-dev equivalent of an inbound WhatsApp message |
| GET | `/api/tickets?propertyId=` | List tickets with intent/guest/staff context — response now includes `slaDeadline`/`escalatedAt` (FR-10) |
| PATCH | `/api/tickets/:id` | Update ticket status |
| GET | `/api/guests?propertyId=` | Guest list with reservation + recent messages |
| GET | `/api/metrics?propertyId=` | Headline counters for the sidebar — adds an `escalatedTickets` count (FR-10), scoped the same way `openTickets`/`totalTickets` are today |
| GET | `/api/reviews?propertyId=` | **New** — pending review queue items |
| PATCH | `/api/reviews/:id` | **New** — `{action: "approve"\|"reject", editedReply?}` |
| GET | `/api/reports/daily?propertyId=` | **New** — Executive daily report |

## 10. Success Metrics (Phase 1 exit criteria)

Matches the Blueprint's Financial Impact Funnel: 90%+ of routine (housekeeping/maintenance)
requests ticketed without manual routing; average acknowledgement <10s; 100% of reception/guest
service replies reviewed during the pilot window with zero unreviewed sends.

## 11. Assumptions & Dependencies

- A single pilot property is sufficient for Phase 1 validation (matches Blueprint's "single hotel" pilot).
- Real PMS and WhatsApp credentials are Phase 1 *integration* work, not Phase 1 *product* work — the interfaces are complete; the vendor-specific implementations are not.
- Arabic dialect NLU accuracy is the highest-risk item and is explicitly out of scope for automated correctness in Phase 1 (rule-based engine is a placeholder, not a claim of production NLU quality).
- PDPL data residency (§7.7) and the consent mechanism it requires (FR-9) are treated as Phase 1 product requirements, not a pre-launch checklist item, per `docs/PROJECT_PLAN.md`'s engagement principle 4 ("Compliance and security are Phase 0 work, not a pre-launch checklist item") and its risk register entry for PDPL / data residency misstep.

## 12. Out of Scope

Digital Reputation Agent, Marketing & Sales upsell automation, analytics warehouse, dynamic
pricing, multi-property/Gulf expansion — all Phase 2/3 per the source roadmap. Building these now
would pull effort from proving the Phase 1 loop, which is the actual 90-day wedge.

## 13. Open Questions

- Should FAQ replies (`reception.faq`) really require review, or are they low-risk enough for
  auto-send like housekeeping? This PRD keeps them under review for Phase 1 (matches the agent
  roster table's per-agent, not per-intent, review policy) — revisit once real usage data exists.
- Review queue currently has no timeout/escalation if a staff member doesn't act — needed before
  a real pilot, not blocking for local development. This is distinct from Ticket Board escalation,
  which FR-10 now addresses; a pending review item sitting unactioned is still an open question.
