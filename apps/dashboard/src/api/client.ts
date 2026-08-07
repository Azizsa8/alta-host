const BASE = "/api";

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
  pendingReviews: number;
  recommendations: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
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
