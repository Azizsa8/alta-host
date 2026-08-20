import { useEffect, useState } from "react";
import { api, type AuditEntry, type ChainVerification } from "../api/client.js";

/* ===========================================================
   The accountability record. Two things a security review
   asks: "who did what" and "how do you know this wasn't
   edited". The verify button answers the second one live
   rather than asking anyone to take it on trust.
   =========================================================== */

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "تسجيل دخول",
  "review.approve": "موافقة على رد",
  "review.reject": "رفض رد",
  "ticket.status_change": "تغيير حالة تذكرة",
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "كل الأحداث" },
  { value: "auth.login", label: "تسجيل الدخول" },
  { value: "review.approve", label: "الموافقات" },
  { value: "review.reject", label: "الرفض" },
];

export function AuditTrail({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .audit({ limit: 200, action: filter || undefined })
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [filter, refreshKey]);

  async function verify() {
    setVerifying(true);
    try {
      setVerification(await api.verifyAudit());
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="row">
      <div className="col-12 mb-4">
        <div className="card">
          <div className="card-header pb-0 d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <h6 className="mb-0">سجل التدقيق</h6>
              <p className="text-sm text-secondary mb-0">
                سجل غير قابل للتعديل — كل إدخال مرتبط بالذي قبله تشفيريًا، فأي حذف أو تغيير يكسر السلسلة ويُكتشف.
              </p>
            </div>
            <div className="d-flex gap-2 align-items-center">
              <select
                className="form-select form-select-sm"
                style={{ width: 150 }}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm bg-gradient-dark mb-0" onClick={verify} disabled={verifying}>
                {verifying ? "جارٍ التحقق…" : "تحقّق من سلامة السجل"}
              </button>
            </div>
          </div>

          {verification && (
            <div className="px-4 pt-3">
              <div
                className="p-3"
                style={{
                  borderRadius: 10,
                  background: verification.valid ? "#eaf6ec" : "#fbeeee",
                  border: `1px solid ${verification.valid ? "#c9e6cf" : "#f3cfcf"}`,
                }}
              >
                <b style={{ color: verification.valid ? "#2f7d4f" : "#b23b3b" }}>
                  {verification.valid ? "✓ السلسلة سليمة" : "✗ السلسلة مكسورة"}
                </b>
                <span className="text-sm text-secondary ms-2">
                  تم فحص <b className="mono">{verification.checked}</b> إدخال
                  {verification.brokenAtSeq && ` — الكسر عند الإدخال رقم ${verification.brokenAtSeq}`}
                </span>
                {verification.reason && <p className="text-xs text-secondary mb-0 mt-1">{verification.reason}</p>}
              </div>
            </div>
          )}

          <div className="card-body pt-3">
            {loading && <p className="text-sm text-secondary">جارٍ التحميل…</p>}
            {!loading && entries.length === 0 && <p className="text-sm text-secondary">لا توجد أحداث مطابقة.</p>}
            {!loading && entries.length > 0 && (
              <div className="table-responsive">
                <table className="table align-items-center mb-0">
                  <thead>
                    <tr>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder">#</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder">الوقت</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder">المستخدم</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder">الحدث</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder">التفاصيل</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder">المصدر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.seq}>
                        <td className="text-xs text-secondary mono">{e.seq}</td>
                        <td className="text-xs text-secondary mono" style={{ whiteSpace: "nowrap" }}>
                          {new Date(e.createdAt).toLocaleString("ar-SA")}
                        </td>
                        <td className="text-sm">{e.actorName}</td>
                        <td>
                          <span
                            className={`badge ${e.outcome === "failure" ? "bg-gradient-danger" : "bg-gradient-secondary"}`}
                          >
                            {ACTION_LABELS[e.action] ?? e.action}
                            {e.outcome === "failure" ? " — فشل" : ""}
                          </span>
                        </td>
                        <td className="text-xs text-secondary" style={{ maxWidth: 340 }}>
                          {renderMetadata(e)}
                        </td>
                        <td className="text-xs text-secondary mono">{e.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Turns the metadata blob into the one line that matters for each action. */
function renderMetadata(e: AuditEntry): string {
  const m = e.metadata;
  if (e.action === "auth.login" && e.outcome === "failure") return String(m.reason ?? "");
  if (e.action.startsWith("review.")) {
    const edited = m.edited ? "عُدّل النص يدويًا" : "أُرسل نص الوكيل كما هو";
    return `${String(m.department ?? "")} · ${edited}`;
  }
  const entries = Object.entries(m);
  return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "—";
}
