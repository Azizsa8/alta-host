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

  // العاجل أولاً — لم يُرسل أي شيء هنا للنزيل بعد.
  const sorted = [...items].sort((a, b) => (b.intent.urgency === "urgent" ? 1 : 0) - (a.intent.urgency === "urgent" ? 1 : 0));

  return (
    <div className="row">
      <div className="col-12 mb-4">
        <p className="text-sm text-secondary mb-0">
          ردود الاستقبال وخدمة النزلاء تنتظر هنا قبل وصولها للنزيل — سياسة المراجعة البشرية (الأيام 31–60) من
          مخطط التنفيذ. عدّل النص إن لزم، ثم اعتمد أو ارفض.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-secondary">جارٍ التحميل…</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-secondary">لا يوجد شيء بالانتظار — القائمة فارغة.</p>
      ) : (
        sorted.map((item) => (
          <div className="col-lg-6 mb-4" key={item.id}>
            <div className="card h-100">
              <div className="card-header pb-0 d-flex justify-content-between align-items-start">
                <div>
                  <b className="mono text-sm">{item.intent.type}</b>
                  <p className="text-xs text-secondary mb-0 mt-1">
                    النزيل: {item.intent.message.conversation.guest.name ?? item.intent.message.conversation.guest.whatsappId}
                  </p>
                </div>
                {item.intent.urgency === "urgent" && <span className="badge bg-gradient-danger">عاجل</span>}
              </div>
              <div className="card-body pt-2">
                <p className="text-sm fst-italic text-secondary">"{item.intent.message.rawText}"</p>
                <div className="mb-3">
                  <label className="form-label text-sm">الرد المقترح (قابل للتعديل)</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={drafts[item.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                  />
                </div>
                <div className="d-flex gap-2">
                  <button className="btn bg-gradient-success mb-0" disabled={busyId === item.id} onClick={() => approve(item)}>
                    اعتماد وإرسال
                  </button>
                  <button className="btn btn-outline-secondary mb-0" disabled={busyId === item.id} onClick={() => reject(item)}>
                    رفض
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
