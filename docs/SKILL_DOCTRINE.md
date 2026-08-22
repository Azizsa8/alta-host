# ALTA Skill Doctrine — Step 0

**Standing order:** read this before starting any task, whatever the task is.

Source: `/home/ais04/AITMPL/` — the aitmpl.com catalogue.
**873 skills · 420 agents · 285 commands · 97 MCPs · 61 hooks · 32 plugins · 70 settings.**

---

## 1. What is actually loaded right now

20 catalogue skills are already live in this session and can be invoked immediately:

`Frontend Design` (12,996) · `Code Reviewer` (8,601) · `Senior Frontend` (7,676) · `Ui Ux Pro Max` (7,045) ·
`Senior Backend` (6,677) · `Senior Architect` (5,513) · `Ui Design System` (4,447) · `Senior Fullstack` (3,211) ·
`Webapp Testing` (2,832) · `Brainstorming` (2,797) · `Mobile Design` (2,450) · `Clean Code` (1,639) ·
`Mcp Builder` (1,422) · `3d Web Experience` (1,192) · `Scroll Experience` (534) · `Web Design Guidelines` (493) ·
`Premium Web Design` (248) · `Code Review` (119)

Everything else in the catalogue requires installing before it can be used. Presets below are marked
**LIVE** (usable today) or **INSTALL** (needs adding first) so a preset is never claimed as available when it isn't.

---

## 2. What makes a preset "god-mode"

A preset is not a pile of skills. Piling them on produces overlap and contradiction — three design skills
arguing about the same button.

A real preset is a **chain where each stage consumes the previous stage's output**, and it covers the full
arc that most work actually needs:

> **intent → design → build → verify → harden → hand off**

Two rules that make the difference:

1. **One owner per stage.** Exactly one skill leads each stage. Others advise. Two design skills leading
   simultaneously is worse than either alone.
2. **Never skip verify.** The stage most often dropped is the one that catches the bug. A preset without a
   verification stage is a preset that ships confident and wrong — which this project has already
   demonstrated twice (a blank graph and a 65×-slower webhook, both of which typechecked cleanly).

---

## 3. The presets

### P1 · SHIP-VERIFIED — default for any feature
**Use for:** any change that alters behaviour. This is the default; deviate deliberately, not by drift.

| Stage | Skill | State |
|---|---|---|
| Intent | `Brainstorming` | LIVE |
| Architecture | `Senior Architect` | LIVE |
| Build | `Senior Backend` / `Senior Frontend` | LIVE |
| Style discipline | `Clean Code` | LIVE |
| Verify | `Webapp Testing` | LIVE |
| Review | `Code Reviewer` | LIVE |

**Fully usable today.** Anchor preset — most ALTA work runs through this.

---

### P2 · DESIGN-GOD — anything a client sees
**Use for:** dashboards, guest-facing surfaces, pitch artifacts.

| Stage | Skill | State |
|---|---|---|
| Direction | `Frontend Design` (lead) | LIVE |
| System | `Ui Design System` — tokens, spacing, type scale | LIVE |
| Decisions | `Ui Ux Pro Max` — palettes, font pairings, layout | LIVE |
| Premium tier | `Premium Web Design` — only when "expensive" is the brief | LIVE |
| Data surfaces | `dataviz` — charts, KPI tiles | LIVE |
| Gate | `Web Design Guidelines` + `Accessibility Auditor` | LIVE / INSTALL |

**Ordering rule:** direction *before* system *before* decisions. Inverting this produces a themed template
rather than a designed thing. Arabic RTL is a hard constraint on every stage here.

---

### P3 · FORTRESS — before any client security review
**Use for:** the enterprise trust package, pre-pilot hardening.

| Stage | Skill | State |
|---|---|---|
| Posture | `Senior Security` | INSTALL |
| API surface | `Api Security Best Practices` | INSTALL |
| Sweep | `Vulnerability Scanner` + `Top Web Vulnerabilities` | INSTALL |
| Authn/z | `Broken Authentication` | INSTALL |
| Evidence | `Security Audit` + `Pentest Checklist` | INSTALL |
| Compliance | `Data Privacy Compliance` (PDPL/GDPR shape) | INSTALL |

Pairs with the existing `security-review` command already available here.

---

### P4 · SAAS-FOUNDATION — multi-tenancy, done once, correctly
**Use for:** the `Tenant` model the brief mandates. Highest-leverage preset for ALTA right now.

| Stage | Skill | State |
|---|---|---|
| Tenancy pattern | `Saas Multi Tenant` | INSTALL |
| Schema | `Database Architect` + `Postgres Schema Design` | INSTALL |
| Performance | `Postgresql Optimization` | INSTALL |
| Isolation enforcement | `Api Security Best Practices` | INSTALL |
| Migration safety | `Database Migration` | INSTALL |

Retrofitting tenancy is the single most expensive mistake available to this codebase. Run the whole chain.

---

### P5 · API-CONTRACT — the §14 handover deliverable
| Stage | Skill | State |
|---|---|---|
| Shape | `Api Design Principles` + `Api Patterns` | INSTALL |
| Docs | `Api Documentation Generator` (OpenAPI/Swagger) | INSTALL |
| Client types | `Openapi To Typescript` | INSTALL |
| Handoff | `Backend To Frontend Handoff Docs` | INSTALL |
| Validation | `Zod Validation Expert` | INSTALL |

Directly satisfies the brief's Swagger requirement, which the current Express build genuinely lacks.

---

### P6 · QA-MAX — when "it works" needs to be provable
| Stage | Skill | State |
|---|---|---|
| Strategy | `Senior Qa` | INSTALL |
| E2E | `Webapp Testing` | LIVE |
| Generation | `/generate-tests` (command) | INSTALL |
| Failure analysis | `Systematic Debugging` | INSTALL |
| Access | `Accessibility Auditor` | INSTALL |

---

### P7 · GROWTH-ENGINE — the brief's marketing module (§6-هـ)
| Stage | Skill | State |
|---|---|---|
| Strategy | `Marketing Strategy Pmm` | INSTALL |
| Voice | `Brand Guidelines` | INSTALL |
| Copy | `Copywriting` + `Marketing Psychology` | INSTALL |
| Social | `Social Content` + `Content Creator` | INSTALL |
| Discovery | `Seo Optimizer` | INSTALL |
| Assets | `Image Enhancer` | INSTALL |

This preset *is* the content studio's intelligence layer. The module needs the plumbing; this is the brain.

---

### P8 · OPS-RELIABILITY — running it, not just building it
| Stage | Skill | State |
|---|---|---|
| Pipeline | `Senior Devops` | INSTALL |
| Infra | `Devops Iac Engineer` + `Docker Expert` | INSTALL |
| Workflow | `Workflow Automation` | INSTALL |
| Jobs | `Inngest` / `Trigger Dev` (reference patterns) | INSTALL |

---

### P9 · AGENT-FORGE — for the agent platform itself
| Stage | Skill | State |
|---|---|---|
| Patterns | `Autonomous Agent Patterns` | INSTALL |
| Memory | `Agent Memory Systems` | INSTALL |
| Orchestration | `Langgraph` (reference) | INSTALL |
| Evaluation | `Agent Evaluation` | INSTALL |
| Tooling | `Mcp Builder` | LIVE |

`Agent Evaluation` matters most: ALTA has agents making guest-facing decisions with no accuracy measurement.

---

### P10 · DATA-TRUTH — reports and the executive dashboard
| Stage | Skill | State |
|---|---|---|
| Modelling | `Database Architect` | INSTALL |
| Queries | `Sql Pro` + `Postgresql Optimization` | INSTALL |
| Presentation | `dataviz` | LIVE |
| Spreadsheets | `Excel Analysis` | INSTALL |

---

## 4. Preset → ALTA gap map

| Brief gap (§11 acceptance) | Preset |
|---|---|
| Tenant isolation, structurally | **P4** + P3 |
| Manual takeover (`ai_paused`) | **P1** |
| Storage + quotas | **P1** + P8 |
| Work orders, technician photos | **P1** + P2 |
| Knowledge base + agent policies | **P9** + P1 |
| Google reviews | **P1** + P7 |
| Social content studio | **P7** + P1 |
| OpenAPI / handover pack | **P5** |
| Security review readiness | **P3** |
| Visual quality throughout | **P2** |

---

## 5. Supporting catalogue worth pulling

**Agents (420):** `expert-advisors` (52) and `development-team` (17) are the useful clusters — a
`Frontend Developer` / `Code Reviewer` agent pair maps onto P1 directly.

**MCPs (97):** `Context7` (367 — live, version-specific library docs) would have prevented the two
Mastra API mistakes this project already hit, where published docs disagreed with the installed version.
`Memory Integration` (340) for cross-session continuity.

**Hooks (61):** `Smart Commit`, plus the `security` cluster (8) for pre-tool guards.

**Commands (285):** `/generate-tests`, `/ultra-think` for structured analysis.

---

## 6. How to apply this

1. Identify the stage the task is really at — most "just build X" requests are actually at *intent*.
2. Pick one preset. Announce it.
3. Run the stages in order. Do not skip verify.
4. If a needed skill is INSTALL-only, say so rather than silently substituting a weaker live one.
