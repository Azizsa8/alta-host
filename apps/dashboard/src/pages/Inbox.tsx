import { useEffect, useRef, useState } from "react";
import {
  api,
  type ChatMessage,
  type ConversationSummary,
  type Staff,
} from "../api/client.js";

/* ===========================================================
   §4 صندوق رسائل النزلاء + §6-ب manual takeover.
   The takeover button is the point: one press and the AI goes
   silent on this conversation — enforced server-side, this UI
   only reflects it. Returning to AI is manager-only.
   =========================================================== */

export function Inbox({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const isManager = ["manager", "hotel_manager", "general_manager"].includes(staff.role);

  useEffect(() => {
    api.conversations().then(setConversations).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    api.conversationMessages(selectedId).then(setMessages).catch(() => {});
  }, [selectedId, refreshKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function doTakeover() {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.takeover(selectedId);
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, aiPaused: true, takenOverBy: staff.name } : c))
      );
    } finally {
      setBusy(false);
    }
  }

  async function doResume() {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.resumeAi(selectedId);
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, aiPaused: false, takenOverBy: null } : c))
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    try {
      await api.manualReply(selectedId, reply.trim());
      setReply("");
      setMessages(await api.conversationMessages(selectedId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ minHeight: 560 }}>
      {/* conversation list */}
      <div className="col-lg-4 mb-4">
        <div className="card" style={{ height: 620, display: "flex", flexDirection: "column" }}>
          <div className="card-header pb-2">
            <h6 className="mb-0">المحادثات</h6>
            <p className="text-xs text-secondary mb-0">أحدث المحادثات أولًا</p>
          </div>
          <div className="card-body pt-1" style={{ overflowY: "auto" }}>
            {conversations.length === 0 && <p className="text-sm text-secondary">لا توجد محادثات بعد.</p>}
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="p-2 mb-1"
                style={{
                  borderRadius: 10,
                  cursor: "pointer",
                  background: selectedId === c.id ? "#fdeef2" : "transparent",
                  border: selectedId === c.id ? "1px solid #f6d3de" : "1px solid transparent",
                }}
              >
                <div className="d-flex justify-content-between align-items-center">
                  <span className="text-sm font-weight-bold">
                    {c.guest.name ?? c.guest.whatsappId}
                  </span>
                  {c.aiPaused ? (
                    <span className="badge bg-gradient-warning">استلام يدوي</span>
                  ) : (
                    <span className="badge bg-gradient-success">AI نشط</span>
                  )}
                </div>
                {c.lastMessage && (
                  <p className="text-xs text-secondary mb-0 text-truncate">
                    {c.lastMessage.direction === "outbound" ? "↩ " : ""}
                    {c.lastMessage.text}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* thread */}
      <div className="col-lg-8 mb-4">
        <div className="card" style={{ height: 620, display: "flex", flexDirection: "column" }}>
          {!selected ? (
            <div className="card-body d-flex align-items-center justify-content-center">
              <p className="text-secondary">اختر محادثة من القائمة</p>
            </div>
          ) : (
            <>
              <div className="card-header pb-2 d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                  <h6 className="mb-0">{selected.guest.name ?? selected.guest.whatsappId}</h6>
                  <p className="text-xs text-secondary mb-0 mono">{selected.guest.whatsappId}</p>
                </div>
                <div className="d-flex gap-2 align-items-center">
                  {selected.aiPaused ? (
                    <>
                      <span className="text-xs text-secondary">
                        بعهدة: <b>{selected.takenOverBy ?? "موظف"}</b>
                      </span>
                      {isManager && (
                        <button className="btn btn-sm btn-outline-dark mb-0" onClick={doResume} disabled={busy}>
                          إعادة للوضع الذكي
                        </button>
                      )}
                    </>
                  ) : (
                    <button className="btn btn-sm bg-gradient-warning mb-0" onClick={doTakeover} disabled={busy}>
                      استلام المحادثة
                    </button>
                  )}
                </div>
              </div>

              {selected.aiPaused && (
                <div className="px-3 pt-2">
                  <div
                    className="text-xs p-2"
                    style={{ background: "#fdf3e3", border: "1px solid #f0ddb4", borderRadius: 8, color: "#8a5a10" }}
                  >
                    الذكاء الاصطناعي متوقف عن الرد في هذه المحادثة — الردود يدوية فقط
                    {!isManager && "، وإعادته تحتاج مديرًا"}.
                  </div>
                </div>
              )}

              <div className="card-body pt-2" style={{ overflowY: "auto", flex: 1 }}>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className="d-flex mb-2"
                    style={{ justifyContent: m.direction === "outbound" ? "flex-start" : "flex-end" }}
                  >
                    <div
                      className="p-2 px-3 text-sm"
                      style={{
                        maxWidth: "70%",
                        borderRadius: 14,
                        background: m.direction === "outbound" ? "#eaf4f4" : "#f0f2f5",
                        border: "1px solid " + (m.direction === "outbound" ? "#cfe5e5" : "#e2e6ea"),
                      }}
                    >
                      {m.text}
                      <div className="text-xxs text-secondary mt-1 mono" style={{ fontSize: 10 }}>
                        {new Date(m.at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                        {m.mediaType === "voice" ? " · 🎙 صوتية" : ""}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="card-footer d-flex gap-2 pt-2">
                <input
                  className="form-control"
                  placeholder="اكتب ردًا يدويًا…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendReply()}
                />
                <button className="btn bg-gradient-primary mb-0" onClick={sendReply} disabled={busy || !reply.trim()}>
                  إرسال
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
