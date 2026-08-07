import { useEffect, useState } from "react";
import { api, type Ticket } from "../api/client.js";

const COLUMNS: Array<{ key: Ticket["status"]; label: string; next?: Ticket["status"] }> = [
  { key: "open", label: "Open", next: "in_progress" },
  { key: "in_progress", label: "In Progress", next: "done" },
  { key: "done", label: "Done" },
];

const STALE_WARN_MS = 30 * 60 * 1000; // 30 minutes
const STALE_DANGER_MS = 2 * 60 * 60 * 1000; // 2 hours

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

/** Age bucket used to visually flag tickets that have sat open too long. */
function ageBucket(diffMs: number): AgeBucket {
  if (diffMs >= STALE_DANGER_MS) return "danger";
  if (diffMs >= STALE_WARN_MS) return "warn";
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
                  // "done" tickets are resolved, so age no longer represents an SLA risk.
                  const bucket: AgeBucket = col.key === "done" ? "ok" : ageBucket(diffMs);
                  return (
                    <div
                      className={`ticket-card${bucket !== "ok" ? ` stale-${bucket}` : ""}`}
                      key={t.id}
                    >
                      <div className="top">
                        <p className="summary">{t.summary}</p>
                        <div className="badges">
                          {t.intent.urgency === "urgent" && <span className="chip urgent">urgent</span>}
                          <span className={`chip age-${bucket}`} title={new Date(t.createdAt).toLocaleString()}>
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
