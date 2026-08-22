// Local dev and the Caddy-fronted docker-compose deploy both proxy /api on
// the same origin as the dashboard itself, so a relative path is correct
// there. A standalone static host (e.g. Vercel) has no such proxy — set
// VITE_API_BASE_URL to an absolute URL (e.g. a tunnel or a deployed API's
// origin) at build time to point the dashboard at it instead.
const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;

export interface Staff {
  id: string;
  name: string;
  role: string;
  propertyId: string;
}

const TOKEN_KEY = "alta_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// App.tsx registers a handler here so a 401 anywhere (an expired token, not
// just a failed login) immediately drops back to the login screen instead
// of leaving every caller to check for it individually.
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export interface DispatchOutcome {
  intentType: string;
  status: "sent" | "queued_for_review";
  reply?: string;
}

export interface SimulateResult {
  guest: { id: string; whatsappId: string; name: string | null };
  intentEnvelope: {
    rawText: string;
    intents: Array<{ type: string; params: Record<string, unknown>; confidence: number }>;
    sentiment: string;
    urgency: string;
  };
  outcomes: DispatchOutcome[];
}

export interface Ticket {
  id: string;
  department: string;
  status: "open" | "in_progress" | "done";
  summary: string;
  createdAt: string;
  slaDeadline: string;
  escalatedAt: string | null;
  assignedStaff: { name: string } | null;
  intent: {
    type: string;
    sentiment: string;
    urgency: string;
    message: { rawText: string; conversation: { guest: { whatsappId: string; name: string | null } } };
  };
  actions: Array<{ agent: string; action: string; detail: string; createdAt: string }>;
}

export interface Guest {
  id: string;
  whatsappId: string;
  name: string | null;
  reservations: Array<{ roomNumber: string; checkIn: string; checkOut: string; status: string }>;
  conversations: Array<{ messages: Array<{ direction: string; rawText: string; createdAt: string }> }>;
}

export interface Metrics {
  totalTickets: number;
  openTickets: number;
  escalatedTickets: number;
  urgentIntents: number;
  guestCount: number;
  pendingReviews: number;
}

export interface ReviewItem {
  id: string;
  department: string;
  draftReply: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  intent: {
    type: string;
    urgency: string;
    sentiment: string;
    message: {
      rawText: string;
      conversation: { guest: { whatsappId: string; name: string | null } };
    };
  };
}

export interface DailyReport {
  propertyId: string;
  totalTickets: number;
  ticketsByDepartment: Record<string, number>;
  sentimentBreakdown: Record<string, number>;
  urgentCount: number;
  escalatedCount: number;
  pendingReviews: number;
  recommendations: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Harmless no-op against a real API; needed when VITE_API_BASE_URL
      // points at a localtunnel.me origin (used for standalone preview
      // deploys) — localtunnel otherwise serves an HTML "click to
      // continue" interstitial to browser-originated requests instead of
      // proxying them, which silently breaks every fetch call here.
      "Bypass-Tunnel-Reminder": "true",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    // Only trigger the "force back to login" handler if a token actually
    // just got invalidated — a fresh login attempt with no token yet is
    // also a 401 on wrong credentials, and shouldn't re-fire the handler
    // that's already showing the login screen.
    const hadToken = !!token;
    clearToken();
    if (hadToken) unauthorizedHandler?.();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface LiveEvent {
  seq: string;
  propertyId: string;
  type: string;
  payload: Record<string, unknown> & { type: string };
  createdAt: string;
}

/** Opens the authenticated SSE feed. EventSource reconnects automatically
 *  and resends Last-Event-ID, so missed events replay server-side. The
 *  JWT rides as ?token= because EventSource can't set headers. */
export function eventStream(onEvent: (evt: LiveEvent) => void): () => void {
  const token = getToken();
  if (!token) return () => {};
  const source = new EventSource(`${BASE}/events/stream?token=${encodeURIComponent(token)}`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as LiveEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}

export const api = {
  login: async (username: string, password: string) => {
    const result = await request<{ token: string; staff: Staff }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setToken(result.token);
    return result.staff;
  },
  me: () => request<{ staff: Staff }>("/auth/me").then((r) => r.staff),
  logout: () => clearToken(),
  simulate: (payload: { propertyId: string; from: string; text: string; guestName?: string }) =>
    request<SimulateResult>("/simulate", { method: "POST", body: JSON.stringify(payload) }),
  tickets: (propertyId: string) => request<Ticket[]>(`/tickets?propertyId=${propertyId}`),
  updateTicketStatus: (id: string, status: Ticket["status"]) =>
    request<Ticket>(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  guests: (propertyId: string) => request<Guest[]>(`/guests?propertyId=${propertyId}`),
  metrics: (propertyId: string) => request<Metrics>(`/metrics?propertyId=${propertyId}`),
  reviews: (propertyId: string) => request<ReviewItem[]>(`/reviews?propertyId=${propertyId}`),
  approveReview: (id: string, editedReply?: string) =>
    request<ReviewItem>(`/reviews/${id}`, { method: "PATCH", body: JSON.stringify({ action: "approve", editedReply }) }),
  rejectReview: (id: string) =>
    request<ReviewItem>(`/reviews/${id}`, { method: "PATCH", body: JSON.stringify({ action: "reject" }) }),
  dailyReport: (propertyId: string) => request<DailyReport>(`/reports/daily?propertyId=${propertyId}`),
  agents: () => request<AgentDefinition[]>("/agents"),
  conversations: () => request<ConversationSummary[]>("/conversations"),
  conversationMessages: (id: string) => request<ChatMessage[]>(`/conversations/${id}/messages`),
  takeover: (id: string) => request<{ aiPaused: boolean }>(`/conversations/${id}/takeover`, { method: "POST" }),
  resumeAi: (id: string) => request<{ aiPaused: boolean }>(`/conversations/${id}/resume-ai`, { method: "POST" }),
  manualReply: (id: string, text: string) =>
    request<{ sent: boolean }>(`/conversations/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) }),
  audit: (opts: { limit?: number; action?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.action) q.set("action", opts.action);
    return request<AuditEntry[]>(`/audit?${q.toString()}`);
  },
  verifyAudit: () => request<ChainVerification>("/audit/verify"),
  recentEvents: (limit = 60) => request<LiveEvent[]>(`/events/recent?limit=${limit}`),
  storageQuota: () => request<StorageQuota>("/storage/quota"),
  storageFiles: (status: "active" | "trashed" = "active") =>
    request<StorageFile[]>(`/storage/files?status=${status}`),
  requestUpload: (payload: { kind: string; name: string; mime: string; sizeBytes: number }) =>
    request<UploadGrant>("/storage/uploads", { method: "POST", body: JSON.stringify(payload) }),
  confirmUpload: (fileId: string) =>
    request<{ confirmed: boolean }>(`/storage/uploads/${fileId}/confirm`, { method: "POST" }),
  fileUrl: (fileId: string) => request<{ url: string }>(`/storage/files/${fileId}/url`),
  trashFile: (fileId: string) =>
    fetch(`${BASE}/storage/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getToken()}` },
    }).then((r) => r.status === 204),
  restoreFile: (fileId: string) =>
    request<{ restored: boolean }>(`/storage/files/${fileId}/restore`, { method: "POST" }),
  workOrders: () => request<WorkOrder[]>("/workorders"),
  createWorkOrder: (payload: {
    title: string;
    category: string;
    priority: string;
    location: string;
    assigneeId?: string;
  }) => request<WorkOrder>("/workorders", { method: "POST", body: JSON.stringify(payload) }),
  assignWorkOrder: (id: string, assigneeId: string) =>
    request<WorkOrder>(`/workorders/${id}/assign`, { method: "POST", body: JSON.stringify({ assigneeId }) }),
  addWorkOrderUpdate: (id: string, payload: { note: string; photoFileIds?: string[]; statusTo?: string }) =>
    request<unknown>(`/workorders/${id}/updates`, { method: "POST", body: JSON.stringify(payload) }),
  closeWorkOrder: (id: string, note?: string) =>
    request<{ closed: boolean }>(`/workorders/${id}/close`, { method: "POST", body: JSON.stringify({ note }) }),
  staffList: () => request<Array<{ id: string; name: string; role: string }>>("/staff"),
  knowledge: () => request<KnowledgeItem[]>("/knowledge"),
  createKnowledge: (payload: { title: string; contentAr: string; contentEn?: string; tags?: string[] }) =>
    request<KnowledgeItem>("/knowledge", { method: "POST", body: JSON.stringify(payload) }),
  setKnowledgeStatus: (id: string, status: "draft" | "approved" | "retired") =>
    request<KnowledgeItem>(`/knowledge/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  agentPolicies: () => request<AgentPolicyRow[]>("/agent-policies"),
  setAgentEnabled: (agentKey: string, enabled: boolean) =>
    request<AgentPolicyRow>(`/agent-policies/${agentKey}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  agentRuns: (agentKey?: string) =>
    request<AgentRunRow[]>(`/agent-runs${agentKey ? `?agentKey=${agentKey}` : ""}`),
  reputation: () => request<ReputationData>("/reputation/reviews"),
  linkGoogle: (accountRef: string, oauthRefreshToken?: string) =>
    request<{ linked: boolean }>("/reputation/link", { method: "POST", body: JSON.stringify({ accountRef, oauthRefreshToken }) }),
  syncReviews: () => request<{ fetched: number; new: number }>("/reputation/sync", { method: "POST" }),
  publishReviewReply: (id: string, editedReply?: string) =>
    request<{ published: boolean }>(`/reputation/reviews/${id}/approve`, { method: "POST", body: JSON.stringify({ editedReply }) }),
  brandProfile: () => request<BrandProfile>("/content/brand"),
  saveBrandProfile: (p: Partial<BrandProfile>) =>
    request<BrandProfile>("/content/brand", { method: "PUT", body: JSON.stringify(p) }),
  contentIdeas: () => request<{ ideas: string[] }>("/content/ideas", { method: "POST" }),
  contentItems: () => request<ContentItemRow[]>("/content"),
  createContent: (p: { idea: string; channel: string; mediaFileIds?: string[] }) =>
    request<ContentItemRow>("/content", { method: "POST", body: JSON.stringify(p) }),
  editContent: (id: string, p: { bodyAr?: string; bodyEn?: string; mediaFileIds?: string[] }) =>
    request<ContentItemRow>(`/content/${id}`, { method: "PATCH", body: JSON.stringify(p) }),
  transitionContent: (id: string, to: string, scheduledAt?: string) =>
    request<ContentItemRow>(`/content/${id}/transition`, { method: "POST", body: JSON.stringify({ to, scheduledAt }) }),
  publishContent: (id: string) =>
    request<{ published: boolean; resultUrl: string }>(`/content/${id}/publish`, { method: "POST" }),
};

export interface BrandProfile {
  identity: string;
  services: string[];
  offers: string[];
  audience: string;
  tone: string;
  language: "ar" | "en" | "both";
}

export interface ContentItemRow {
  id: string;
  idea: string;
  bodyAr: string;
  bodyEn: string;
  channel: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  resultUrl: string;
  updatedAt: string;
}

export interface GoogleReviewRow {
  id: string;
  stars: number;
  text: string;
  author: string;
  reviewedAt: string;
  sentiment: "positive" | "neutral" | "negative";
  topic: string;
  draftReply: string;
  replyStatus: "none" | "draft" | "approved" | "published";
  publishedAt: string | null;
}

export interface ReputationData {
  linked: boolean;
  accountRef: string | null;
  average: number;
  reviews: GoogleReviewRow[];
}

export interface KnowledgeItem {
  id: string;
  title: string;
  contentAr: string;
  contentEn: string;
  tags: string[];
  status: "draft" | "approved" | "retired";
  updatedAt: string;
}

export interface AgentPolicyRow {
  agentKey: string;
  enabled: boolean;
}

export interface AgentRunRow {
  id: string;
  agentKey: string;
  intentType: string;
  policyApplied: string;
  durationMs: number;
  outputs: { status?: string; replyPreview?: string };
  createdAt: string;
}

export interface WorkOrderUpdateEntry {
  id: string;
  authorName: string;
  note: string;
  photoFileIds: string[];
  statusTo: string | null;
  createdAt: string;
}

export interface WorkOrder {
  id: string;
  title: string;
  category: string;
  priority: "critical" | "high" | "normal" | "low";
  status: "new" | "assigned" | "in_progress" | "awaiting_confirm" | "closed";
  assigneeId: string | null;
  assigneeName?: string | null;
  createdByName?: string | null;
  location: string;
  createdAt: string;
  updates: WorkOrderUpdateEntry[];
}

export interface StorageQuota {
  quotaGb: number;
  usedBytes: string;
  usedPct: number;
}

export interface StorageFile {
  id: string;
  kind: string;
  name: string;
  mime: string;
  sizeBytes: string;
  status: string;
  createdAt: string;
}

/** A presigned-PUT grant: the browser uploads straight to object storage
 *  with this URL, then confirms — file bytes never pass through the API. */
export interface UploadGrant {
  ok: true;
  fileId: string;
  uploadUrl: string;
  alert80: boolean;
}

/** One agent's declarative config from the backend registry — what the
 *  Operations Center renders as a node, and what the fleet inspector shows. */
export interface AgentDefinition {
  key: string;
  name: string;
  nameAr: string;
  department: string;
  role: string;
  roleAr: string;
  riskLevel: "low" | "guest_facing";
  reviewPolicy: "immediate" | "human_review";
  handlesIntents: string[];
  tools: string[];
  parent?: string;
  /** 0 supervisor, 1 department specialist, 2 sub-agent. */
  depth: 0 | 1 | 2;
}

export interface AuditEntry {
  seq: string;
  actorName: string;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: "success" | "failure";
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  hash: string;
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtSeq?: string;
  reason?: string;
}

export interface ConversationSummary {
  id: string;
  guest: { id: string; whatsappId: string; name: string | null };
  aiPaused: boolean;
  takenOverBy: string | null;
  lastMessage: { text: string; direction: string; at: string } | null;
}

export interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  mediaType: string;
  at: string;
}
