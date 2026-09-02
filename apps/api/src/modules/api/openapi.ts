/**
 * §14: the API contract, served at /api/docs (Swagger UI) and
 * /api/docs/openapi.json (importable into Postman/Insomnia directly).
 *
 * Kept honest by tests/openapi.test.ts: every route registered on
 * apiRouter must appear here — adding an endpoint without documenting it
 * fails CI. That drift gate, not codegen, is the §14 "contract" promise:
 * the stack ruling kept Express + Zod, so the spec is authored alongside
 * the routes it describes rather than generated from a framework.
 */

type Op = {
  summary: string;
  tag: string;
  auth?: boolean; // default true — the whole /api surface is JWT'd except login
  params?: string[]; // path params
  query?: string[];
  body?: Record<string, string>; // field → type/description
  responses?: Record<string, string>;
};

const j = (fields: Record<string, string>) => ({
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, { type: "string", description: v }])
        ),
      },
    },
  },
});

/** path → method → op. Paths use OpenAPI {param} style. */
export const OPERATIONS: Record<string, Partial<Record<"get" | "post" | "patch" | "put" | "delete", Op>>> = {
  "/auth/login": {
    post: {
      summary: "Staff login — returns JWT + staff profile",
      tag: "auth",
      auth: false,
      body: { username: "string", password: "string" },
      responses: { "200": "token + staff", "401": "bad credentials", "429": "rate limited (20/15min)" },
    },
  },
  "/auth/me": { get: { summary: "Current staff profile from the JWT", tag: "auth" } },
  "/events/stream": {
    get: {
      summary: "SSE live feed (auth via ?token= — EventSource can't set headers); supports Last-Event-ID replay",
      tag: "events",
      query: ["token"],
    },
  },
  "/events/recent": { get: { summary: "Recent events, newest first", tag: "events", query: ["limit"] } },
  "/properties": { get: { summary: "Own property record", tag: "core" } },
  "/staff": { get: { summary: "Own-property staff (id/name/role only)", tag: "core" } },
  "/metrics": { get: { summary: "Operational metrics for the dashboard header", tag: "core", query: ["propertyId"] } },
  "/reports/daily": { get: { summary: "Executive daily report", tag: "core", query: ["propertyId"] } },
  "/simulate": {
    post: {
      summary: "Simulate an inbound guest WhatsApp message through the full pipeline",
      tag: "core",
      body: { propertyId: "string", from: "guest whatsapp id", text: "message text", guestName: "optional" },
    },
  },
  "/agents": { get: { summary: "Agent registry: hierarchy, intents, review policy", tag: "agents" } },
  "/agent-policies": { get: { summary: "Per-agent on/off policies (no row = enabled)", tag: "agents" } },
  "/agent-policies/{agentKey}": {
    patch: { summary: "Toggle an agent (§4 مركز الوكلاء) — manager only", tag: "agents", params: ["agentKey"], body: { enabled: "boolean" } },
  },
  "/agent-runs": { get: { summary: "§9 run log: inputs, outputs, policy applied, duration", tag: "agents", query: ["agentKey"] } },
  "/knowledge": {
    get: { summary: "Knowledge items, all statuses", tag: "knowledge" },
    post: { summary: "Create a knowledge item (draft) — manager only", tag: "knowledge", body: { title: "string", contentAr: "string", contentEn: "optional", tags: "string[]" } },
  },
  "/knowledge/{id}/status": {
    post: { summary: "draft|approved|retired — approval is what agents trust (§6-أ); audited", tag: "knowledge", params: ["id"], body: { status: "draft|approved|retired" } },
  },
  "/tickets": { get: { summary: "Tickets with SLA + escalation state", tag: "tickets", query: ["propertyId"] } },
  "/tickets/{id}": { patch: { summary: "Update ticket status", tag: "tickets", params: ["id"], body: { status: "open|in_progress|done" } } },
  "/reviews": { get: { summary: "Human review queue (§FR-5)", tag: "reviews", query: ["propertyId"] } },
  "/reviews/{id}": {
    patch: { summary: "Approve (optionally edited) or reject a drafted reply", tag: "reviews", params: ["id"], body: { action: "approve|reject", editedReply: "optional" } },
  },
  "/guests": { get: { summary: "Guest profiles (§11-1 scoped)", tag: "guests", query: ["propertyId"] } },
  "/conversations": { get: { summary: "Inbox: conversations with AI/human state", tag: "inbox" } },
  "/conversations/{id}/messages": { get: { summary: "Conversation timeline", tag: "inbox", params: ["id"] } },
  "/conversations/{id}/takeover": { post: { summary: "§6-ب: human takeover — AI silenced immediately", tag: "inbox", params: ["id"] } },
  "/conversations/{id}/resume-ai": { post: { summary: "Return the conversation to AI — manager only (§6-ب)", tag: "inbox", params: ["id"] } },
  "/conversations/{id}/reply": { post: { summary: "Manual staff reply via the gateway", tag: "inbox", params: ["id"], body: { text: "string" } } },
  "/workorders": {
    get: { summary: "Work orders — technicians see ONLY their own (§4)", tag: "workorders", query: ["status"] },
    post: { summary: "Create a work order; critical priority escalates immediately (§6-ج)", tag: "workorders", body: { title: "string", category: "electrical|plumbing|hvac|furniture|other", priority: "critical|high|normal|low", location: "string", assigneeId: "optional", ticketId: "optional" } },
  },
  "/workorders/{id}": { get: { summary: "One work order with its update timeline", tag: "workorders", params: ["id"] } },
  "/workorders/{id}/assign": { post: { summary: "Assign to own-property staff", tag: "workorders", params: ["id"], body: { assigneeId: "uuid" } } },
  "/workorders/{id}/updates": {
    post: { summary: "Progress note + photo evidence (own-property storage files only) + optional status move", tag: "workorders", params: ["id"], body: { note: "string", photoFileIds: "uuid[]", statusTo: "optional" } },
  },
  "/workorders/{id}/close": {
    post: { summary: "Close — critical WOs require maintenance-manager confirm (§6-ج); technician attempt parks at awaiting_confirm", tag: "workorders", params: ["id"], body: { note: "optional" } },
  },
  "/storage/quota": { get: { summary: "Quota + usage; 80% alert state (§11-8)", tag: "storage" } },
  "/storage/uploads": {
    post: { summary: "Reserve quota transactionally + mint a 5-min presigned PUT (browser→storage, bytes never transit the API). 507 at full quota", tag: "storage", body: { kind: "fault_photo|content_media|post_image|policy_doc|ticket_attachment", name: "string", mime: "allow-listed", sizeBytes: "number" } },
  },
  "/storage/uploads/{id}/confirm": { post: { summary: "Mark the uploaded file active", tag: "storage", params: ["id"] } },
  "/storage/files": { get: { summary: "File library (active or trashed)", tag: "storage", query: ["status"] } },
  "/storage/files/{id}/url": { get: { summary: "10-min signed download URL — files are never public (§5)", tag: "storage", params: ["id"] } },
  "/storage/files/{id}": { delete: { summary: "Soft-delete to 30-day trash; quota released (§5)", tag: "storage", params: ["id"] } },
  "/storage/files/{id}/restore": { post: { summary: "Restore from trash; quota re-reserved", tag: "storage", params: ["id"] } },
  "/reputation/link": {
    post: { summary: "Link Google Business Profile — real accounts store the OAuth token in the vault (§8), mock: refs need none", tag: "reputation", body: { accountRef: "string (mock:* for dev)", oauthRefreshToken: "required for real accounts, vault-stored, never echoed" } },
  },
  "/reputation/sync": { post: { summary: "Fetch + classify + draft; negative/safety → immediate alert (§6-د). Idempotent", tag: "reputation" } },
  "/reputation/reviews": { get: { summary: "Reviews with classification + stars average", tag: "reputation" } },
  "/reputation/reviews/{id}/approve": {
    post: { summary: "THE only path to published — human approval recorded (§7: no auto-publish)", tag: "reputation", params: ["id"], body: { editedReply: "optional" } },
  },
  "/content/brand": {
    get: { summary: "Brand profile grounding all generation (§6-هـ)", tag: "content" },
    put: { summary: "Update brand profile", tag: "content", body: { identity: "string", services: "string[]", offers: "string[]", audience: "string", tone: "string", language: "ar|en|both" } },
  },
  "/content/ideas": { post: { summary: "Generate ideas from the brand profile", tag: "content" } },
  "/content": {
    get: { summary: "Content items across all statuses", tag: "content" },
    post: { summary: "Create a draft from an idea (AR/EN copy generated)", tag: "content", body: { idea: "string", channel: "instagram|facebook|tiktok", mediaFileIds: "uuid[]" } },
  },
  "/content/{id}": { patch: { summary: "Edit copy/media (published items immutable)", tag: "content", params: ["id"], body: { bodyAr: "optional", bodyEn: "optional", mediaFileIds: "uuid[]" } } },
  "/content/{id}/transition": {
    post: { summary: "Status machine move — 'published' refused here; approval is its own permission (§7)", tag: "content", params: ["id"], body: { to: "draft|in_review|approved|rejected|scheduled|failed", scheduledAt: "ISO date for scheduled" } },
  },
  "/content/{id}/publish": { post: { summary: "Publish now — only from approved/scheduled (§7)", tag: "content", params: ["id"] } },
  "/platform/tenants": {
    get: { summary: "All tenants with plan/status/usage — alta_admin only, cross-tenant by design (§13)", tag: "platform" },
  },
  "/platform/hotels": {
    post: { summary: "§13 onboarding in one call: property + auto-tenant + plan/quota + hotel_manager login", tag: "platform", body: { propertyId: "slug", name: "string", plan: "trial|basic|pro|enterprise", quotaGb: "number", managerName: "string", managerUsername: "string", managerPassword: "min 10 chars, write-only" } },
  },
  "/platform/tenants/{id}": {
    patch: { summary: "Set plan/quota, suspend or reactivate — suspension cuts the hotel's staff API access", tag: "platform", params: ["id"], body: { plan: "optional", quotaGb: "optional", status: "active|suspended" } },
  },
  "/social/channels": {
    get: { summary: "Every catalogue channel merged with this hotel's settings and analytics", tag: "social" },
  },
  "/social/channels/{channel}": {
    patch: { summary: "Per-channel settings: enable, handle, cadence, best times, tone, hashtags, auto-publish (§7 default off)", tag: "social", params: ["channel"], body: { enabled: "boolean", autoPublish: "boolean — off means every post needs approval", handle: "string", postsPerWeek: "number", bestTimes: "HH:MM[]", tone: "string", hashtags: "string[]", audienceNote: "string" } },
  },
  "/social/channels/{channel}/generate": {
    post: { summary: "Generate drafts sized and toned for this channel; over-length drafts are flagged, never silently cut", tag: "social", params: ["channel"], body: { count: "1-5" } },
  },
  "/social/channels/{channel}/connect": {
    post: { summary: "Start a connection — returns an OAuth authorize URL when a developer app is registered, the credential fields when it is not, or an honest note when the platform has no automated surface", tag: "social", params: ["channel"] },
  },
  "/social/channels/{channel}/credentials": {
    post: { summary: "Store a channel token in the vault (AES-256-GCM). The platform must accept the token first — a rejected token is never stored as a working connection", tag: "social", params: ["channel"], body: { token: "write-only, never echoed", account: "page/channel id" } },
  },
  "/social/channels/{channel}/connection": {
    delete: { summary: "Disconnect: removes the vault entry and drops the channel's claimed capabilities", tag: "social", params: ["channel"] },
  },
  "/social/calendar": { get: { summary: "Slot plan per channel from cadence + best times, with gaps flagged", tag: "social", query: ["days"] } },
  "/social/analytics": { get: { summary: "Followers, reach, engagement per channel; flags configured-but-idle channels", tag: "social" } },
  "/complaints": {
    get: { summary: "Complaint cases, highest reputation risk first", tag: "complaints", query: ["status"] },
    post: { summary: "Open a case from a staff-reported complaint; triage scores category, severity and reputation risk", tag: "complaints", body: { text: "string", guestId: "optional uuid" } },
  },
  "/complaints/patterns": { get: { summary: "90-day view: repeat root causes, category mix, containment rate, median resolution", tag: "complaints" } },
  "/complaints/{id}": {
    get: { summary: "One case with its RCA answers and action plan", tag: "complaints", params: ["id"] },
    patch: { summary: "Update status/actions/owner — resolving needs a root cause AND a completed action, and is manager-only", tag: "complaints", params: ["id"], body: { status: "open|investigating|action_planned|resolved|escalated", actions: "[{action,owner,dueAt,done}]", preventive: "string", ownerId: "uuid", resolutionNote: "string" } },
  },
  "/complaints/{id}/rca": {
    post: { summary: "Record the five-whys answers and root cause; derives an action plan whose deadlines tighten with severity", tag: "complaints", params: ["id"], body: { answers: "[{question,answer}]", rootCause: "string (required)", contributing: "string[]" } },
  },
  "/audit": { get: { summary: "Tamper-evident audit trail (SHA-256 hash chain)", tag: "audit", query: ["limit", "action"] } },
  "/audit/verify": { get: { summary: "Walk the hash chain; reports first broken seq if any", tag: "audit" } },
  "/credentials": {
    get: { summary: "Credential summaries (hint only — values never leave the vault)", tag: "credentials" },
    put: { summary: "Store/rotate a credential (AES-256-GCM) — hotel_manager only", tag: "credentials", body: { key: "known key", value: "write-only" } },
  },
  "/credentials/{key}": { delete: { summary: "Remove a credential", tag: "credentials", params: ["key"] } },
};

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, methods] of Object.entries(OPERATIONS)) {
    paths[`/api${path}`] = {};
    for (const [method, op] of Object.entries(methods)) {
      if (!op) continue;
      paths[`/api${path}`][method] = {
        summary: op.summary,
        tags: [op.tag],
        security: op.auth === false ? [] : [{ bearerAuth: [] }],
        parameters: [
          ...(op.params ?? []).map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
          ...(op.query ?? []).map((name) => ({ name, in: "query", required: false, schema: { type: "string" } })),
        ],
        ...(op.body ? { requestBody: j(op.body) } : {}),
        responses: Object.fromEntries(
          Object.entries(op.responses ?? { "200": "success" }).map(([code, desc]) => [code, { description: desc }])
        ),
      };
    }
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "HostOps API",
      version: "1.0.0",
      description:
        "منصة HostOps — WhatsApp-first hospitality AI agents. All endpoints are tenant-scoped to the authenticated staff's property (§11-1); the JWT, not query params, decides whose data you see.",
    },
    servers: [{ url: "/", description: "same origin (Caddy)" }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
    tags: [
      { name: "auth" }, { name: "core" }, { name: "events" }, { name: "agents" },
      { name: "knowledge" }, { name: "tickets" }, { name: "reviews" }, { name: "guests" },
      { name: "inbox" }, { name: "workorders" }, { name: "storage" }, { name: "reputation" },
      { name: "content" }, { name: "social" }, { name: "complaints" }, { name: "audit" }, { name: "credentials" }, { name: "platform" },
    ],
    paths,
  };
}
