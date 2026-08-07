# ALTA — Full Delivery Plan (How a Top-Tier Agency Would Run This)

What's shipped so far (this repo, this session) is a Phase 1 proof-of-concept: the pipeline works,
the interfaces are right, the PRD is real. A professional delivery org wouldn't call that done —
they'd treat it as the *discovery output* that earns the right to plan the rest properly. This
document is that plan: how the engagement is staffed, the phases, the exit criteria that gate
moving from one to the next, and the risks that actually sink projects like this.

The one discipline that separates a serious delivery plan from a roadmap slide: **every phase
below ends in a go/no-go gate with a measurable exit criterion, not a date.** A phase that doesn't
hit its criterion doesn't advance — it gets fixed or the plan changes. That's what keeps "90-day
MVP" from quietly becoming a 9-month death march.

---

## 1. Engagement Principles

1. **De-risk before scaling, not after.** Nobody signs 100 hotels before one hotel's staff has
   used this for a month. The pilot property isn't a formality — it's the thing every later
   decision depends on.
2. **One cross-functional pod, not department handoffs.** PM, design, and engineering sit in the
   same sprint, not a waterfall of specs thrown over walls.
3. **Fixed-scope phases with hard exit criteria.** "Let's see how Phase 1 goes" is not a plan.
4. **Compliance and security are Phase 0 work, not a pre-launch checklist item.** PDPL data
   residency and WhatsApp Business policy compliance shape the architecture; retrofitting them
   is what turns a 4-month project into an 8-month one.
5. **The riskiest assumption gets tested first.** Here, that's Gulf-dialect NLU accuracy on real
   guest audio — not the dashboard UI. Sequencing work by risk, not by what's easiest to demo.

## 2. Team Structure

| Role | Allocation | Why they're needed |
|---|---|---|
| Engagement/Program Lead | Full-time | Single accountable owner; the client should never have to chase status across five people |
| Product Manager | Full-time | Owns the PRD, backlog, and phase-gate criteria — keeps scope honest |
| Solutions Architect / Tech Lead | Full-time | Owns the architecture doc, makes the build-vs-adopt calls (e.g. the Chatwoot question) |
| Backend Engineers ×2–3 | Full-time | Orchestration, PMS adapters, review queue, ticketing |
| Frontend Engineer ×1–2 | Full-time | Command Center dashboard |
| AI/NLP Engineer ×1–2 | Full-time | ASR pipeline, dialect-aware intent extraction, the actual hard problem |
| DevOps/Platform Engineer | Full-time from Phase 1 | CI/CD, multi-tenancy, observability, the containerized deploy this session already built |
| QA/Test Engineer | Full-time from Phase 1 | Test strategy, regression suite — nothing here has automated tests yet |
| UX/UI Designer | Full-time Phase 0–1, part-time after | WhatsApp conversation design *and* dashboard — conversational UX is a real discipline, not an afterthought |
| Arabic Dialect Consultant | Contract, ongoing | Validates NLU training data and output quality — the accuracy risk doesn't get solved by engineers alone |
| Hospitality Domain Expert | Contract, Phase 0 heavy | This is the PRD's "21 industry expert interviews" — a workflow that looks obviously right to engineers is often wrong on the floor |
| Security/Compliance Lead | Fractional | PDPL, WhatsApp Business Solution Provider (BSP) terms, guest consent capture |
| Customer Success / Pilot Lead | Full-time from Phase 2 | Owns the pilot property relationship, staff training, and the feedback loop back into the product |

## 3. Phases

### Phase 0 — Discovery & Validation (Weeks 1–4)

The work that de-risks everything after it. Skipping this is the single most common reason
hospitality-tech pilots fail — not bad code, a workflow nobody at the front desk actually uses.

**Work:**
- Stakeholder workshops; pressure-test [docs/PRD.md](PRD.md) against real operators, not just the
  source strategy docs
- 21+ expert interviews across GM, front desk, housekeeping, maintenance (per the source
  Blueprint's own field-validation plan)
- Select and **contractually commit** a pilot property — this is a signed relationship, not a
  handshake
- PMS data audit: confirm the pilot's actual PMS (Oracle OPERA or Mews), API access level,
  documentation quality, and what a certification/partnership process (Oracle in particular often
  requires one) actually takes in calendar time
- Kick off WhatsApp Business Solution Provider (BSP) selection and account approval — this has
  real lead time and should start now, not in Phase 1
- PDPL data-residency review: confirm hosting region, guest consent capture mechanism

**Exit criteria:** signed pilot agreement · PMS API access confirmed in writing · BSP application
submitted · PRD reflects real interview findings, not just the source docs

### Phase 1 — Foundation Build (Weeks 5–10)

This is roughly where this session's work sits today, hardened for a real property instead of a
demo. The MVP pipeline, review queue, and containerized deploy already exist; this phase replaces
every mock with the pilot's real systems.

**Work:**
- Real ASR + dialect-aware intent extraction replacing the rule-based placeholder — the actual
  hard engineering problem, started here because Phase 2 depends on it working on real audio
- Real `PMSAdapter` implementation against the pilot's specific PMS (not the mock)
- Real WhatsApp Cloud API connection (sandbox/test mode — full production approval often lands
  mid-phase, not before it starts)
- CI/CD pipeline, staging environment, structured logging/observability
- Automated test suite (currently: none — this is the phase that fixes that)
- Security hardening: secrets management, auth on the dashboard, audit logging already scaffolded
  via `AgentAction`

**Exit criteria:** staging environment live · real WhatsApp number connected · real PMS read/write
verified against a pilot-property test booking · CI green on a real test suite

### Phase 2 — Human-in-the-Loop Pilot (Weeks 11–14)

Matches the source Blueprint's own "4–8 week semi-manual experiment." Every reception/guest-service
reply goes through the Review Queue — no exceptions, regardless of how confident the model looks
in testing.

**Work:**
- Deploy to the pilot property; staff onboarding and training (WhatsApp-first, low friction by
  design, but front-desk buy-in still has to be earned)
- Daily monitoring: intent accuracy, review approve/edit/reject rates, response latency
- Weekly retro with pilot staff — this is the feedback loop the NLU model actually improves from
- NLU iteration cycles against real guest message data collected during the pilot

**Exit criteria:** intent-extraction accuracy above an agreed threshold on real traffic · staff
adoption confirmed (not just tolerated) via structured feedback · review turnaround time within
target

### Phase 3 — Autonomous Launch & ROI Measurement (Weeks 15–18)

Maps to the source Blueprint's Days 61–90. This is where `AUTO_APPROVE_INTENTS` — already built
as a config toggle in this session's work — actually gets used for the first time, one validated
intent type at a time, not all at once.

**Work:**
- Graduate intent types to autonomous send individually, each with its own before/after comparison
- Full Executive Report and Ticket Board in live daily use by management
- Formal before/after ROI measurement: call volume, response time, guest sentiment, direct-booking
  impact

**Exit criteria:** meets the PRD's §10 success metrics · management has a go/no-go recommendation
backed by measured numbers, not vibes

### Phase 4 — Scale-Out (Months 5–12)

Only starts once Phase 3's numbers justify it. This is where Phase 2 features from the source PRD
(Digital Reputation Agent, Marketing & Sales upsell automation) get built — deliberately not
before, per this repo's existing scope discipline.

**Work:**
- Multi-tenancy battle-tested with a second and third real property (not just the `property_id`
  scaffolding already in the schema)
- Second and third PMS adapter (the two named across all three source docs: whichever of
  Oracle OPERA / Mews wasn't the pilot's system)
- Digital Reputation Agent, Marketing & Sales Agent
- Self-serve onboarding tooling — reducing agency-hours-per-new-hotel is what makes "100 hotels"
  economically real instead of aspirational
- Analytics warehouse (schema already designed for this in Phase 1, populated for real here)

**Exit criteria:** N properties live simultaneously without incident · per-property onboarding
time reduced to a defined target

### Phase 5 — Predictive Intelligence & Regional Expansion (Year 2–3)

The source docs' "Ultimate Brain" — dynamic pricing, occupancy forecasting — plus Gulf regional
expansion (UAE, Qatar, Kuwait), each of which brings its own compliance and localization work,
not just a config change.

---

## 4. Delivery Cadence & Governance

- **2-week sprints**, sprint demo and retro every cycle — the client sees working software every
  two weeks, not a reveal at the end of a phase
- **Weekly steering committee** with pilot-property stakeholders (GM, IT, ops) starting Phase 0
- **Formal phase-gate review** before advancing — the exit criteria above are the actual agenda,
  not a rubber stamp
- **Risk register reviewed every sprint**, not just when something breaks
- **Change control**: anything that would pull Phase 4/5 scope into Phase 1–3 gets logged and
  explicitly declined or explicitly re-scoped — this is the discipline that's kept this repo's own
  README honest about what's "deliberately not built yet"

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gulf-dialect NLU accuracy insufficient on real guest audio | High | High | Sequenced first in Phase 1, not deferred; dedicated dialect consultant; Phase 2 exists specifically to catch this before autonomy |
| WhatsApp BSP approval delay | Medium | Medium | Application submitted in Phase 0, not Phase 1 |
| PMS API access/certification slower than expected (especially Oracle OPERA) | Medium | High | Confirmed in writing during Phase 0, before any build commitment is made |
| Staff adoption fails despite good tech (hospitality turnover, training fatigue) | Medium | High | Dedicated Customer Success/Pilot Lead from Phase 2; weekly retros are a listening mechanism, not just a status update |
| PDPL / data residency misstep | Low | High | Security/Compliance Lead engaged from Phase 0, not pre-launch |
| Scope creep into Phase 2/3 before Phase 1 is proven | Medium | Medium | Formal change control; this repo's own README already models the discipline of naming what's out of scope |
| Pilot property not representative of the target segment | Low | High | Selection criteria set explicitly in Phase 0 against the PRD's persona (the "Forgotten Middle," 50–250 rooms) |

## 6. Effort Sizing (Directional, Not a Quote)

Team-month ranges, not currency — actual cost depends on team location, seniority mix, and rate
card, none of which this document can responsibly guess at:

| Phase | Duration | Approx. team-months |
|---|---|---|
| 0 — Discovery & Validation | 4 weeks | ~6–8 |
| 1 — Foundation Build | 6 weeks | ~14–18 |
| 2 — Human-in-the-Loop Pilot | 4 weeks | ~10–12 |
| 3 — Autonomous Launch | 4 weeks | ~8–10 |
| 4 — Scale-Out | 8 months | ongoing, scales with property count |
| 5 — Predictive & Regional | Year 2–3 | separate engagement, re-scoped at the time |

Phases 0–3 (the actual 90-day-plus-runway to a validated pilot) are the number worth pinning down
with a real agency quote — everything past that depends on what Phase 3's numbers actually show.

## 7. What This Session Already Delivered Against Phase 0/1

For orientation: [docs/PRD.md](PRD.md) and the working codebase in `apps/` are Phase 0's PRD
output and a meaningful head start on Phase 1's build — the pipeline, review queue, containerized
deploy, and interface boundaries (`PMSAdapter`, `IntentEngine`) that Phase 1's real integrations
plug into. What's still open from Phase 1: real ASR/NLU, a real PMS adapter, a real WhatsApp
connection, CI/CD, and an automated test suite — all listed above, none of it hidden.
