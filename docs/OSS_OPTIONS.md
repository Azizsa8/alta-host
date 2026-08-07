# Self-Hosted OSS Options for ALTA

Findings from [selfh.st/apps](https://selfh.st/apps/) — a maintained directory, not a generic
web search, so what's listed below is actually catalogued there with stars/activity/license
data, not just "things I remember exist." Mapped against the six architecture layers so it's
clear what each tool would replace or accelerate, and what it wouldn't.

One negative result worth stating up front: **nothing hotel-PMS-shaped exists in this
directory** — no self-hosted property management system came up under "booking," "hotel,"
"reservation," or "PMS." That's not a gap in the search, it's a confirmation that the
architecture's "integrate, don't replace the PMS" decision (PRD FR unrelated — see architecture
doc Layer 04) is the right call. Nobody self-hosts their way out of needing Oracle OPERA / Mews
integration.

## Layer 01/06 — Guest Interface & Command Center: **Chatwoot**

[chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) — 36k stars, tagged Support/Ticketing.
This is the single most relevant find. Chatwoot is an omnichannel inbox (WhatsApp, email, live
chat, SMS) with a first-class **WhatsApp Cloud API channel** built in, contact/conversation
history, canned responses, and — critically — an **Agent Bot API**: a bot (our NLU + agent
pipeline) can post a *suggested* reply into a conversation that a human approves or edits before
it sends to the guest. That is our Review Queue (FR-6), already productized with a real UI,
instead of the bespoke one in `apps/dashboard`.

**Where it fits:** could replace `apps/api/src/modules/whatsapp/` + the Review Queue UI wholesale
— Chatwoot owns the WhatsApp connection and the human-approval UI; ALTA's agents become a bot
integration that reads inbound conversations via webhook and posts draft replies via Chatwoot's
API instead of `sendWhatsAppMessage`. Ticket creation for housekeeping/maintenance would still be
custom (Chatwoot is a support inbox, not a task router), so `Ticket`/`AgentAction` stay ours.
**Verify before committing to it:** confirm current WhatsApp Cloud API channel setup requirements
and licensing terms directly on the repo — some Chatwoot features are enterprise-gated and that
boundary shifts over time.

## Layer 02 — Intelligence (NLU/ASR): **Speaches**, **LibreTranslate**

- [Speaches](https://github.com/speaches-ai/speaches) — 4k stars, tagged Artificial
  Intelligence/Language/Transcription. Whisper-compatible self-hosted transcription +
  translation API. Direct fit for the "voice note → text" step (architecture doc Layer 02.1,
  ASR) — swap in as the implementation behind whatever ASR call `RuleBasedIntentEngine`'s
  successor makes, without sending guest audio to a third-party vendor.
- [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) — 16k stars, tagged
  Language. Self-hosted MT API. **Caveat:** standard machine translation, not dialect-aware —
  won't solve Gulf-dialect intent extraction on its own (that's still an LLM/fine-tuned-model
  problem per the architecture doc's stated risk), but useful as a normalization or fallback
  layer, or for staff-facing translation of guest messages in the review queue.

## Layer 03 — Agent Orchestration: **n8n**

[n8n](https://github.com/n8n-io/n8n) — 200k stars, tagged Workflow Automation. Worth flagging
specifically: **this is already running on this machine** (`ais04`'s existing `n8n` process was
visible during this session). Rather than only the hand-rolled Express orchestrator in
`apps/api/src/modules/orchestrator/`, n8n could host the dispatch logic as a visual workflow:
WhatsApp webhook trigger → LLM node (intent extraction) → IF/Switch nodes per intent type → HTTP
Request node to the PMS adapter → WhatsApp send node. It has native AI/LangChain nodes for this
exact shape. Tradeoff: faster to iterate on for non-engineers, harder to unit-test and code-review
than the current TypeScript orchestrator — reasonable as a Phase 2 evaluation, not a Phase 1
swap-in, given the PRD's review-queue and PMS-mutation-ordering requirements are easier to
guarantee in code than in a visual workflow tool.

## Layer 03/04 — LLM Inference: **LocalAI**

[LocalAI](https://github.com/mudler/LocalAI) — 48k stars, tagged Artificial
Intelligence/Front End. Drop-in OpenAI-compatible REST API, self-hosted. Relevant specifically
because of the PRD's PDPL data-residency requirement (§7.4 of the architecture doc) — if intent
extraction eventually calls an LLM, routing that through a self-hosted, in-Kingdom-hostable
inference server is a defensible way to keep guest message content from leaving the property's
infrastructure, at the cost of running/maintaining model infra instead of calling a hosted API.

## Layer 05/06 — Support Ticketing, CRM, Ops Visibility

- [Zammad](https://github.com/zammad/zammad) — 6k stars, Support/Ticketing. A more full-featured
  alternative to the bespoke Ticket Board if Housekeeping/Maintenance ever need SLAs, shift
  schedules, or reporting beyond what `apps/dashboard`'s board does today.
- [Twenty](https://github.com/twentyhq/twenty) — 54k stars, CRM — API-first, modern. Candidate
  for Phase 2's Marketing & Sales Agent (guest history, upsell targeting) rather than building a
  guest CRM from scratch.
- [Netdata](https://github.com/netdata/netdata) / [Grafana](https://github.com/grafana/grafana) +
  [Prometheus](https://github.com/prometheus/prometheus) — real-time and time-series monitoring.
  Relevant once this is a real pilot: the architecture doc's NFR for Hajj/Umrah 10x elastic
  capacity needs actual observability to know when autoscaling is triggering, not just app logs.

## Infra: **Caddy** or **Traefik**

Both are reverse proxies with automatic TLS — needed the moment the WhatsApp webhook has to be
publicly reachable with a real certificate, which local dev doesn't require but a pilot property
will.

## What this doesn't change

None of this contradicts [docs/PRD.md](PRD.md) — it's options for *which* implementation sits
behind the interfaces the PRD already specifies (`PMSAdapter`, `IntentEngine`, the WhatsApp
gateway), not a reason to change the interfaces themselves. The one genuinely architecture-level
question worth a real decision is Chatwoot: adopting it changes who owns the guest conversation
and the review UI, which is a bigger call than swapping an ASR vendor and shouldn't be made
without checking its WhatsApp setup requirements and license terms first.
