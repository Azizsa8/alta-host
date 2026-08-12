// Local dev and the Caddy-fronted docker-compose deploy both proxy /api on
// the same origin as the dashboard itself, so a relative path is correct
// there. A standalone static host (e.g. Vercel) has no such proxy — set
// VITE_API_BASE_URL to an absolute URL (e.g. a tunnel or a deployed API's
// origin) at build time to point the dashboard at it instead.
const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api`;

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
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
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
};
