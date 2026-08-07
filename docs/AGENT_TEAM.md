# ALTA — Agent Team (Audit)

Twelve Claude Code subagents in `.claude/agents/`, one per role in
[docs/PROJECT_PLAN.md](PROJECT_PLAN.md) §2's team table. The files are correctly formatted per
the standard Claude Code convention (frontmatter `name`/`description`/`tools`, correct path). The
GitHub/MCP tooling each one references is real and current (verified via web search this session,
not recalled from memory) and cited.

## Verification actually performed — and what it found

Tested by spawning `subagent_type: "security-compliance-lead"` directly. **It failed**: this
session's Agent tool has a fixed subagent registry (`claude`, `claude-code-guide`, `Explore`,
`general-purpose`, `Plan`, `statusline-setup`) that doesn't scan `.claude/agents/` at all — files,
path, and frontmatter were all confirmed correct, so this isn't a mistake on this repo's side.
It traces back to the earlier finding in this session that this environment runs on
`openclaw-gateway.service` (a third-party reimplementation), not Anthropic's own `claude` CLI —
native `.claude/agents/` auto-discovery is a real, documented feature of the official CLI that
this particular runtime doesn't implement the same way.

**Working fallback, verified for real**: pass a role file's content as explicit context to
`subagent_type: "general-purpose"`. Tested with `security-compliance-lead.md` — the agent
correctly adopted the role, investigated the actual PRD, and **caught a real error**: two of these
role files (`solutions-architect.md`, `ai-nlp-engineer.md`, and `security-compliance-lead.md`
itself) cited "docs/PRD.md §7.4" as the source of the PDPL data-residency requirement. That's
wrong — `docs/PRD.md` contains zero mentions of PDPL, residency, or consent; that language only
exists in `docs/PROJECT_PLAN.md`. Fixed in all three files, and — more importantly — this is now
flagged as a real, still-open gap: **the PRD itself has no data-residency requirement**, only the
delivery plan does. That's a `product-manager` task, not a documentation typo.

So: the role definitions work as *content* (proven — one caught a real bug in its own citations
within the first test), but not yet as *native subagent_type routing* in this session. Use them by
reading the file and passing it to `general-purpose`, not by naming the type directly, until this
environment's Agent tool (or a switch to the official `claude` CLI, per the earlier Claude Desktop
conversation) supports native discovery.

## Roster

Status column: "Verified" = actually tested this session (one role, end-to-end). "Content ready"
= same format, same fallback mechanism applies, not individually re-tested — no reason to expect
a different result, but stated honestly as untested rather than implied.

| Role | File | Real toolkit referenced | Status |
|---|---|---|---|
| Engagement/Program Lead | `program-lead.md` | Linear/Jira MCP, GitHub MCP | Content ready; MCPs not connected |
| Product Manager | `product-manager.md` | Linear/Jira MCP, GitHub MCP | Content ready; MCPs not connected |
| Solutions Architect | `solutions-architect.md` | GitHub MCP, Semgrep MCP | Content ready; MCPs not connected |
| Backend Engineer ×2–3 | `backend-engineer.md` | GitHub MCP, Postgres MCP, Docker MCP | Content ready; MCPs not connected |
| Frontend Engineer ×1–2 | `frontend-engineer.md` | Figma MCP, Playwright MCP, GitHub MCP | Content ready; MCPs not connected |
| AI/NLP Engineer ×1–2 | `ai-nlp-engineer.md` | CAMeL Tools, Farasa, AraBERT, Speaches, LocalAI, `data-designer`, `rag-blueprint` | Content ready; libraries not installed, skills need explicit invocation |
| DevOps/Platform Engineer | `devops-engineer.md` | Docker MCP, Kubernetes MCP, GitHub MCP | Content ready; MCPs not connected |
| QA/Test Engineer | `qa-engineer.md` | Playwright MCP, Semgrep MCP, GitHub MCP | Content ready; MCPs not connected |
| UX/UI Designer | `ux-ui-designer.md` | Figma MCP | Content ready; MCP not connected |
| Arabic Dialect Consultant | `arabic-dialect-consultant.md` | CAMeL Tools, Farasa, AraBERT (as reference, not implementation) | Content ready; used for judgment, not code |
| Hospitality Domain Expert | `hospitality-domain-expert.md` | None — deliberately tooling-free | Content ready; this role's leverage is domain knowledge, not tools |
| Security/Compliance Lead | `security-compliance-lead.md` | Semgrep MCP, Trivy | **Verified** — caught its own citation bug on first real use |

## What "audit" found

**Coverage against docs/PROJECT_PLAN.md §2's team table:** complete — all 12 listed roles have a
corresponding subagent. Headcount multiples (Backend ×2–3, Frontend ×1–2, AI/NLP ×1–2) are
represented as one subagent definition each, spawnable multiple times in parallel via the Agent
tool when work genuinely parallelizes — a static file per headcount doesn't make sense since
they'd be identical.

**One role deliberately has no tooling**: `hospitality-domain-expert`. Every other role's search
turned up real GitHub tools or MCP servers; this one's value is structured operational judgment
(the PRD's own "21 expert interviews"), and forcing a tool into that file would have been
decoration, not function. Naming that honestly matters more than filling a table cell.

**Two skills incorporated per your choice** (not connected as MCP servers — these are Claude Code
skills already available in this environment): `data-designer` for synthetic Gulf-dialect
training data, `rag-blueprint` for knowledge-grounded FAQ replies. Both referenced in
`ai-nlp-engineer.md`, both flagged as "coordinate with arabic-dialect-consultant before trusting
synthetic data as ground truth" — a skill producing output doesn't make that output correct.

**What this audit did NOT do**: connect any MCP server. That requires credentials, local install,
or OAuth setup (Figma Dev Mode server needs a Figma account and file; Linear/Jira MCP needs
workspace access; Postgres MCP needs a connection string) that has to happen in your Claude Code
MCP configuration, not inside a repo. The subagent files reference exactly which server to add and
why; wiring them up is the next real step if a role's tooling gap becomes the actual bottleneck —
no sense connecting a Figma server before there's a Figma file.

## Scope boundaries, by design

Every subagent file ends with an explicit "Scope boundary" section — who they hand off to, what's
not theirs to decide. This mirrors the same discipline `docs/PROJECT_PLAN.md` argues for in human
teams: a cross-functional pod works because roles are clear, not because everyone can do
everything. `product-manager` can't unilaterally change `PMSAdapter`'s shape;
`solutions-architect` can't unilaterally add a PRD requirement. Same rule, now enforced in the
subagent descriptions the Agent tool routes on.

## How to actually use this team, in this environment

Native `subagent_type: "<role-name>"` routing does **not** work here — verified above. Until this
runtime supports discovering `.claude/agents/`, or the session runs through the official `claude`
CLI instead of `openclaw-gateway`, use the fallback that's actually proven to work: read the role
file, pass its content as explicit instructions to `subagent_type: "general-purpose"`. That's not
a workaround of last resort — it caught a real bug in its first use.

If this repo is later opened in the official Claude Code CLI (see the earlier session discussion
on properly installing it, separate from the Claude Desktop fix), these same files should work via
native `subagent_type` routing with no changes — they're already in the standard format.
