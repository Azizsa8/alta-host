# ALTA MVP

Implementation of [docs/PRD.md](docs/PRD.md) — Phase 1 ("Wedge"). A WhatsApp-style guest message
flows through multi-intent extraction; low-risk requests (housekeeping/maintenance) are ticketed
and confirmed immediately, while anything guest-facing from Reception or Guest Service waits in a
human review queue before it sends — matching the Blueprint's Days 31–60 human-in-the-loop policy.

Two apps plus the deployment glue, one repo:

```
apps/
  api/          Express + TypeScript + Prisma (Postgres). The whole pipeline.
  dashboard/    React + TypeScript (Vite). Simulator, review queue, ticket board, guests, exec report.
infra/web/      Caddy: serves the built dashboard, reverse-proxies /api and /webhook to the api service.
docker-compose.yml   db (Postgres) + api + web, wired together for a real deployment.
```

## Running it locally (no containers)

Needs a Postgres instance — easiest is to let docker-compose run just the database:

```bash
npm install
cp .env.example .env               # then: docker compose --env-file .env up -d db
npm run db:migrate   # applies apps/api/prisma/migrations against that db
npm run db:seed       # seeds one demo property, guest, reservation, and on-shift staff
npm run dev:api        # http://localhost:4317
npm run dev:dashboard  # http://localhost:5173 (proxies /api to the API above)
```

## Running the whole thing containerized

```bash
cp .env.example .env   # adjust ports/secrets if the defaults collide with something else on the host
docker compose --env-file .env up -d --build
docker compose exec api npx tsx prisma/seed.ts   # first run only
```

Open `http://localhost:${WEB_PORT}` (`8080` by default) — Caddy serves the dashboard and proxies
`/api/*` and `/webhook/*` to the api container; nothing needs a browser-visible port for the API
itself. `db` runs `pg_isready`-gated so `api` never starts migrations against a database that
isn't accepting connections yet.

For an actual pilot property, set `SITE_ADDRESS` in `.env` to the property's real domain (e.g.
`alta.example-hotel.com`) — Caddy issues and renews TLS automatically, no other change needed.

This host already runs [Coolify](https://coolify.io) (self-hosted PaaS) — `docker-compose.yml` is
directly consumable by it (point a new Coolify resource at this repo) if a managed deploy/rollback
UI is preferred over running `docker compose` by hand.

Open the dashboard, go to **Message Simulator**, and send a message like:

> I need a room cleaning and a two-hour late check-out

It splits into two intents. `housekeeping.clean_room` sends and tickets immediately — no
guest-facing risk. `booking.extend_stay` **queues in the Review Queue** instead of sending; the
PMS checkout time isn't touched until a staff member approves it there. Approve it (editing the
text is optional) and watch the reservation actually update and a ticket land on the **Ticket
Board**. Reject it instead and confirm nothing changed — no message sent, no PMS mutation.

Send a couple of maintenance complaints mentioning the same thing (e.g. "AC") and check the
**Executive Report** — it surfaces a named recommendation once a pattern crosses threshold, not
just a raw count.

## Environment profiles

Three distinct configurations, same codebase:

| | Local dev / demo | Pilot pitch staging | Real signed pilot |
|---|---|---|---|
| `WHATSAPP_PROVIDER` | unset (persisted only) | `waha` (real number, no BSP wait) | `cloud_api` (required) |
| `NLU_PROVIDER` | `rule_based` | `rule_based` or `llm` | `llm` (recommended) |
| `ASR_PROVIDER` | unset | `whisper` if demoing voice messages | `whisper` |
| `PMS_PROVIDER` | `mock` | `mock` | real adapter once one exists |
| `AUTO_APPROVE_INTENTS` | empty | empty | empty until Phase 3 |

`docker compose up -d` (no `--profile dev`) is the staging/pilot-safe default — it never starts
the WAHA container, so there's no accidental path to sending real guest traffic through an
unofficial transport. `GET /health` (proxied straight through by Caddy, same path) is a plain liveness check — point an
uptime monitor at it once this is deployed somewhere that matters.

## What's real vs. stubbed

Nothing here *requires* API keys or vendor accounts to run — every external integration is
implemented behind an interface, with a working mock/rule-based/self-hosted implementation
standing in as the default. This is deliberate: the same design the architecture doc argues for
(PMS adapter interface, pluggable IntentEngine) is what makes each of these a same-shaped swap
later, not a rewrite.

| Component | Default (no config) | Real implementation |
|---|---|---|
| WhatsApp send/receive | Persisted only, not delivered (`WHATSAPP_PROVIDER=cloud_api` with no credentials) | `WHATSAPP_PROVIDER=cloud_api` + `WHATSAPP_CLOUD_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` — Meta's official Business Cloud API, the only transport a real pilot should use |
| NLU / intent extraction | `RuleBasedIntentEngine` — keyword/regex rules covering the demo intent set, English and Arabic | `NLU_PROVIDER=llm` + `ANTHROPIC_API_KEY` — Claude-backed `LlmIntentEngine`, same `IntentEnvelope` output shape |
| Voice message transcription | Unhandled — voice messages are acked but not processed (`ASR_PROVIDER` unset) | `ASR_PROVIDER=whisper` — self-hosted, open-weights Whisper (`@xenova/transformers`), no external account; downloads model weights on first use |
| PMS | `MockPMSAdapter` — in-memory-ish, reads/writes the same `Reservation` table a real sync would populate | `apps/api/src/modules/pms/mockAdapter.ts` — implement `PMSAdapter` against Oracle OPERA / Mews, wire up via `PMS_PROVIDER` (not built yet — needs a real pilot's PMS to target) |

Data store is already real Postgres, dev and prod alike — no swap needed there; `docker-compose.yml`'s `db` service is the same image either way, just with a stronger password and a real backup policy for a pilot.

Everything downstream of these interfaces — the orchestrator, the three agent handlers, ticket
routing, the dashboard — doesn't know or care which implementation it's talking to.

### WAHA — dev/demo-only WhatsApp transport

`WHATSAPP_PROVIDER=waha` swaps in a self-hosted [WAHA](https://github.com/devlikeapro/waha)
instance instead of Meta's Cloud API. It needs no WhatsApp Business Solution Provider approval —
useful for exercising a real WhatsApp number during local development or a pilot pitch before a
real Business number is approved — but it drives WhatsApp through an unofficial Web-protocol
client, not Meta's sanctioned API, and carries a real risk of the connected number being banned by
WhatsApp at any real message volume. **Never point it at a number used for actual guest traffic.**
A signed pilot always uses `WHATSAPP_PROVIDER=cloud_api` (the default).

Start it with:

```bash
docker compose --profile dev up -d waha
```

It only runs with `--profile dev` — a default or staging `docker compose up` never starts it.

## What's deliberately not built yet

Per the architecture doc's Phase 1 scope: Digital Reputation Agent, Marketing & Sales upsell
automation, and the analytics warehouse are Phase 2/3. Building them now would be scope creep
against the actual 90-day wedge, which is proving the Reception / Guest Service / Housekeeping
loop end-to-end.

## Graduating an intent type to autonomous send

Set `AUTO_APPROVE_INTENTS` in `apps/api/.env` to a comma-separated list of intent types (e.g.
`booking.extend_stay`) to skip the review queue for those types — the mechanism the PRD names for
the Days 61–90 autonomy graduation. Empty by default, so Phase 1 always reviews reception/guest
service output.

## Source docs

The three original strategy docs (PRD, Implementation Blueprint, ALTA Workflow) live at the repo
root as PDFs. [docs/PRD.md](docs/PRD.md) is the engineering spec this codebase implements, and is
the one that should be updated first when behavior needs to change.
