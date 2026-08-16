import { useEffect, useState } from "react";
import { api, type Ticket } from "../api/client.js";

const COLUMNS: Array<{ key: Ticket["status"]; label: string; next?: Ticket["status"] }> = [
  { key: "open", label: "مفتوحة", next: "in_progress" },
  { key: "in_progress", label: "قيد التنفيذ", next: "done" },
  { key: "done", label: "مكتملة" },
];

const DEPARTMENT_LABELS: Record<string, string> = {
  reception: "الاستقبال",
  housekeeping: "التدبير المنزلي",
  maintenance: "الصيانة",
  guest_service: "خدمة النزلاء",
};

type SlaBucket = "ok" | "warn" | "danger";

/** Formats a past ISO timestamp as a short relative-time string, e.g. "5د مضت". */
function relativeTime(diffMs: number): string {
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم`;
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
function slaBucket(ticket: Ticket, now: number): SlaBucket {
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

const BADGE_CLASS: Record<SlaBucket, string> = {
  ok: "bg-gradient-secondary",
  warn: "bg-gradient-warning",
  danger: "bg-gradient-danger",
};

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

  if (loading) {
    return <p className="text-sm text-secondary">جارٍ التحميل…</p>;
  }

  return (
    <div className="md-kanban">
      {COLUMNS.map((col) => {
        const colTickets = tickets.filter((t) => t.status === col.key);
        return (
          <div key={col.key}>
            <div className="md-kanban-col-header">
              {col.label} <span className="mono">({colTickets.length})</span>
            </div>
            {colTickets.length === 0 && <p className="text-sm text-secondary">لا يوجد شيء هنا</p>}
            {colTickets.map((t) => {
              const diffMs = Math.max(0, now - new Date(t.createdAt).getTime());
              const bucket = slaBucket(t, now);
              return (
                <div className={`card md-ticket-card mb-3 ${bucket !== "ok" ? `sla-${bucket}` : ""}`} key={t.id}>
                  <div className="card-body p-3">
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <p className="text-sm font-weight-bold mb-0">{t.summary}</p>
                    </div>
                    <div className="d-flex gap-1 flex-wrap mb-2">
                      {t.intent.urgency === "urgent" && <span className="badge bg-gradient-danger">عاجل</span>}
                      {bucket === "danger" && t.escalatedAt && <span className="badge bg-gradient-danger">تجاوزت المهلة</span>}
                      <span className={`badge ${BADGE_CLASS[bucket]}`} title={`الموعد النهائي: ${new Date(t.slaDeadline).toLocaleString("ar-SA")}`}>
                        {relativeTime(diffMs)}
                      </span>
                    </div>
                    <p className="text-xs text-secondary mono mb-1">
                      {DEPARTMENT_LABELS[t.department] ?? t.department} · {t.intent.type}
                    </p>
                    <p className="text-xs text-secondary mb-1">
                      النزيل: {t.intent.message.conversation.guest.name ?? t.intent.message.conversation.guest.whatsappId}
                    </p>
                    {t.assignedStaff && <p className="text-xs text-secondary mb-2">المسؤول: {t.assignedStaff.name}</p>}
                    {col.next && (
                      <button className="btn btn-outline-secondary btn-sm mb-0 mt-1" onClick={() => advance(t, col.next!)}>
                        نقل إلى {COLUMNS.find((c) => c.key === col.next)!.label} ←
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
