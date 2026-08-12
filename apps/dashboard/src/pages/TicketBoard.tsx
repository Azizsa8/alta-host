import { useEffect, useState } from "react";
import { api, type Ticket } from "../api/client.js";

const COLUMNS: Array<{ key: Ticket["status"]; label: string; next?: Ticket["status"] }> = [
  { key: "open", label: "Open", next: "in_progress" },
  { key: "in_progress", label: "In Progress", next: "done" },
  { key: "done", label: "Done" },
];

type AgeBucket = "ok" | "warn" | "danger";

/** Formats a past ISO timestamp as a short relative-time string, e.g. "5m ago". */
function relativeTime(diffMs: number): string {
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * FR-10: SLA bucket driven by the ticket's real per-department/urgency
 * deadline (computed server-side, see ticketService.ts) rather than a
 * flat age threshold. "danger" once escalatedAt is set (server-persisted,
 * so it never flickers) or once the deadline has passed; "warn" inside the
 * last quarter of the SLA window, so staff get advance notice before a
 * breach, not just after. A "done" ticket is resolved — never flagged,
 * regardless of how far past its deadline it is.
 */
function slaBucket(ticket: Ticket, now: number): AgeBucket {
  if (ticket.status === "done") return "ok";
  if (ticket.escalatedAt) return "danger";

  const deadline = new Date(ticket.slaDeadline).getTime();
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return "danger";

  const created = new Date(ticket.createdAt).getTime();
  const windowMs = Math.max(1, deadline - created);
  if (remainingMs <= windowMs * 0.25) return "warn";
  return "ok";
}

export function TicketBoard({
  propertyId,
  refreshKey,
  onChanged,
}: {
  propertyId: string;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setLoading(true);
    api
      .tickets(propertyId)
      .then((result) => {
        setTickets(result);
        setNow(Date.now());
      })
      .finally(() => setLoading(false));
  }, [propertyId, refreshKey]);

  async function advance(ticket: Ticket, next: Ticket["status"]) {
    await api.updateTicketStatus(ticket.id, next);
    setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status: next } : t)));
    onChanged();
  }

  return (
    <div>
      <h1>Ticket Board</h1>
      <p className="sub">Every ticket traces back to the guest message and intent that created it.</p>

      {loading ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => {
            const colTickets = tickets.filter((t) => t.status === col.key);
            return (
              <div className="board-col" key={col.key}>
                <h3>
                  {col.label} <span className="count">({colTickets.length})</span>
                </h3>
                {colTickets.length === 0 && <p className="empty">Nothing here</p>}
                {colTickets.map((t) => {
                  const diffMs = Math.max(0, now - new Date(t.createdAt).getTime());
                  const bucket = slaBucket(t, now);
                  return (
                    <div
                      className={`ticket-card${bucket !== "ok" ? ` stale-${bucket}` : ""}`}
                      key={t.id}
                    >
                      <div className="top">
                        <p className="summary">{t.summary}</p>
                        <div className="badges">
                          {t.intent.urgency === "urgent" && <span className="chip urgent">urgent</span>}
                          {bucket === "danger" && t.escalatedAt && (
                            <span className="chip age-danger">escalated</span>
                          )}
                          <span
                            className={`chip age-${bucket}`}
                            title={`SLA deadline: ${new Date(t.slaDeadline).toLocaleString()}`}
                          >
                            {relativeTime(diffMs)}
                          </span>
                        </div>
                      </div>
                      <div className="meta">
                        {t.department} · {t.intent.type}
                      </div>
                      <div className="meta">
                        guest: {t.intent.message.conversation.guest.name ?? t.intent.message.conversation.guest.whatsappId}
                      </div>
                      {t.assignedStaff && <div className="meta">assigned: {t.assignedStaff.name}</div>}
                      {col.next && (
                        <div className="actions">
                          <button onClick={() => advance(t, col.next!)}>
                            Move to {COLUMNS.find((c) => c.key === col.next)!.label} →
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
