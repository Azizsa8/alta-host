import { useCallback, useEffect, useState } from "react";
import { api, type GoogleReviewRow, type ReputationData, type Staff } from "../api/client.js";

const TOPIC_LABELS: Record<string, string> = {
  safety: "سلامة",
  cleanliness: "نظافة",
  staff: "الموظفون",
  food: "الطعام",
  facilities: "المرافق",
  value: "القيمة",
  general: "عام",
};
const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-gradient-success",
  neutral: "bg-gradient-secondary",
  negative: "bg-gradient-danger",
};

const REPLY_ROLES = ["manager", "hotel_manager", "general_manager", "marketing_manager"];

/** §4 السمعة الرقمية: Google reviews with classification chips, the
 *  draft editor, and the human approve→publish gate (§7: no auto-publish). */
export function Reputation({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const canReply = REPLY_ROLES.includes(staff.role);
  const [data, setData] = useState<ReputationData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    api.reputation().then(setData).catch((e) => setError(String(e)));
  }, []);
  useEffect(reload, [reload, refreshKey]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-sm text-secondary">جارٍ التحميل…</p>;

  if (!data.linked) {
    return (
      <div className="card">
        <div className="card-header pb-0">
          <h6>السمعة الرقمية — تقييمات Google</h6>
          <p className="text-sm mb-0">اربط حساب Google Business Profile لبدء سحب التقييمات والرد عليها.</p>
        </div>
        <div className="card-body pt-2">
          {error && <p className="text-sm text-danger">{error}</p>}
          {canReply ? (
            <button className="btn btn-sm bg-gradient-primary mb-0" disabled={busy} onClick={() => void act(async () => { await api.linkGoogle(`mock:${staff.propertyId}`); await api.syncReviews(); })}>
              ربط حساب تجريبي (Mock) وسحب التقييمات
            </button>
          ) : (
            <p className="text-sm text-secondary mb-0">اطلب من مدير الفندق ربط الحساب.</p>
          )}
        </div>
      </div>
    );
  }

  const pending = data.reviews.filter((r) => r.replyStatus === "draft");

  return (
    <div className="row">
      <div className="col-12 mb-3">
        <div className="card">
          <div className="card-body d-flex justify-content-between align-items-center py-3">
            <div>
              <h4 className="mb-0">⭐ {data.average}</h4>
              <p className="text-sm text-secondary mb-0">
                متوسط {data.reviews.length} تقييم · {pending.length} بانتظار الرد
              </p>
            </div>
            <button className="btn btn-sm btn-outline-primary mb-0" disabled={busy} onClick={() => void act(() => api.syncReviews())}>
              تحديث التقييمات
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="col-12 mb-3">
          <div className="alert alert-warning text-white text-sm mb-0">{error}</div>
        </div>
      )}

      <div className="col-12">
        {data.reviews.map((r) => (
          <ReviewCard
            key={r.id}
            review={r}
            canReply={canReply}
            busy={busy}
            draft={drafts[r.id] ?? r.draftReply}
            onDraft={(v) => setDrafts((d) => ({ ...d, [r.id]: v }))}
            onPublish={() => void act(() => api.publishReviewReply(r.id, drafts[r.id]))}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({
  review,
  canReply,
  busy,
  draft,
  onDraft,
  onPublish,
}: {
  review: GoogleReviewRow;
  canReply: boolean;
  busy: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onPublish: () => void;
}) {
  const alerting = review.sentiment === "negative" || review.topic === "safety";
  return (
    <div className={`card mb-3 ${alerting && review.replyStatus !== "published" ? "border border-danger" : ""}`}>
      <div className="card-body py-3">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <span className="text-sm font-weight-bold">{"★".repeat(review.stars)}{"☆".repeat(5 - review.stars)}</span>
            <span className="text-sm ms-2 font-weight-bold">{review.author}</span>
            <span className={`badge badge-sm ${SENTIMENT_BADGE[review.sentiment]} ms-2`}>
              {review.sentiment === "positive" ? "إيجابي" : review.sentiment === "negative" ? "سلبي" : "محايد"}
            </span>
            <span className="badge badge-sm bg-gradient-info ms-1">{TOPIC_LABELS[review.topic] ?? review.topic}</span>
            {review.topic === "safety" && <span className="badge badge-sm bg-gradient-danger ms-1">⚠ تنبيه سلامة</span>}
          </div>
          <span className="text-xs text-secondary">{new Date(review.reviewedAt).toLocaleDateString("ar-SA")}</span>
        </div>
        <p className="text-sm mt-2 mb-2">{review.text}</p>

        {review.replyStatus === "published" ? (
          <div className="border-top pt-2">
            <p className="text-xs text-success mb-1">✓ رد منشور</p>
            <p className="text-sm text-secondary mb-0">{review.draftReply}</p>
          </div>
        ) : canReply ? (
          <div className="border-top pt-2">
            <label className="text-xs text-secondary">مسودة الرد (§7: لا نشر تلقائي — النشر بقرارك)</label>
            <textarea className="form-control form-control-sm mb-2" rows={2} value={draft} onChange={(e) => onDraft(e.target.value)} />
            <button className="btn btn-sm bg-gradient-success mb-0" disabled={busy || !draft.trim()} onClick={onPublish}>
              اعتماد ونشر الرد
            </button>
          </div>
        ) : (
          <div className="border-top pt-2">
            <p className="text-xs text-secondary mb-0">مسودة الرد: {review.draftReply}</p>
          </div>
        )}
      </div>
    </div>
  );
}
