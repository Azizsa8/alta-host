import { useEffect, useState } from "react";
import { api, type ReviewItem } from "../api/client.js";

export function ReviewQueue({
  propertyId,
  refreshKey,
  onChanged,
}: {
  propertyId: string;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .reviews(propertyId)
      .then((res) => {
        setItems(res);
        setDrafts(Object.fromEntries(res.map((r) => [r.id, r.draftReply])));
      })
      .finally(() => setLoading(false));
  }, [propertyId, refreshKey]);

  async function approve(item: ReviewItem) {
    setBusyId(item.id);
    try {
      await api.approveReview(item.id, drafts[item.id]);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(item: ReviewItem) {
    setBusyId(item.id);
    try {
      await api.rejectReview(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  // Urgent items first — nothing here has been sent to the guest yet.
  const sorted = [...items].sort((a, b) => (b.intent.urgency === "urgent" ? 1 : 0) - (a.intent.urgency === "urgent" ? 1 : 0));

  return (
    <div>
      <h1>Review Queue</h1>
      <p className="sub">
        Reception and Guest Service replies wait here before they reach the guest — the Days 31–60
        human-in-the-loop policy from the implementation blueprint. Edit the text if needed, then
        approve or reject.
      </p>

      {loading ? (
        <p className="empty">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="empty">Nothing pending — queue is clear.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
          {sorted.map((item) => (
            <div className="panel" key={item.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                <div>
                  <b className="mono">{item.intent.type}</b>
                  <div className="meta" style={{ color: "var(--ink-faint)", fontSize: "0.8rem", marginTop: 2 }}>
                    guest: {item.intent.message.conversation.guest.name ?? item.intent.message.conversation.guest.whatsappId}
                  </div>
                </div>
                {item.intent.urgency === "urgent" && <span className="chip urgent">urgent</span>}
              </div>
              <p style={{ fontStyle: "italic", color: "var(--ink-soft)", fontSize: "0.88rem" }}>
                "{item.intent.message.rawText}"
              </p>
              <div className="field">
                <label>Draft reply (editable)</label>
                <textarea
                  value={drafts[item.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" disabled={busyId === item.id} onClick={() => approve(item)}>
                  Approve &amp; send
                </button>
                <button className="btn ghost" disabled={busyId === item.id} onClick={() => reject(item)}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
