import { useEffect, useState } from "react";
import { api, type Ticket } from "../api/client.js";

const COLUMNS: Array<{ key: Ticket["status"]; label: string; next?: Ticket["status"] }> = [
  { key: "open", label: "Open", next: "in_progress" },
  { key: "in_progress", label: "In Progress", next: "done" },
  { key: "done", label: "Done" },
];

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

  useEffect(() => {
    setLoading(true);
    api
      .tickets(propertyId)
      .then(setTickets)
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
                {colTickets.map((t) => (
                  <div className="ticket-card" key={t.id}>
                    <div className="top">
                      <p className="summary">{t.summary}</p>
                      {t.intent.urgency === "urgent" && <span className="chip urgent">urgent</span>}
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
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
