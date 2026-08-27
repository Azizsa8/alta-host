import { useCallback, useEffect, useState } from "react";
import { api, type ComplaintAction, type ComplaintCaseRow, type ComplaintPatterns, type Staff } from "../api/client.js";

const CATEGORY_LABELS: Record<string, string> = {
  cleanliness: "نظافة",
  staff: "الموظفون",
  noise: "ضجيج",
  food: "الطعام",
  facilities: "المرافق",
  billing: "الفواتير",
  safety: "السلامة",
  general: "عام",
};
const SEVERITY: Record<string, { label: string; cls: string }> = {
  critical: { label: "حرج", cls: "bg-gradient-danger" },
  high: { label: "مرتفع", cls: "bg-gradient-warning" },
  medium: { label: "متوسط", cls: "bg-gradient-info" },
  low: { label: "منخفض", cls: "bg-gradient-secondary" },
};
const STATUS_LABELS: Record<string, string> = {
  open: "مفتوحة",
  investigating: "قيد التحقيق",
  action_planned: "خطة معتمدة",
  resolved: "مُغلقة",
  escalated: "مُصعّدة",
};

const INVESTIGATE_ROLES = ["manager", "hotel_manager", "general_manager", "marketing_manager", "maintenance_manager", "maintenance"];
const RESOLVE_ROLES = ["manager", "hotel_manager", "general_manager"];

/** §6-د: the complaint & reputation manager — catch it before it becomes a
 *  public review, find the real cause, and cut it with a dated plan. */
export function Complaints({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const canInvestigate = INVESTIGATE_ROLES.includes(staff.role);
  const canResolve = RESOLVE_ROLES.includes(staff.role);
  const [cases, setCases] = useState<ComplaintCaseRow[]>([]);
  const [patterns, setPatterns] = useState<ComplaintPatterns | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.complaints().then(setCases).catch((e) => setError(String(e)));
    api.complaintPatterns().then(setPatterns).catch(() => {});
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

  const open = cases.filter((c) => c.status !== "resolved");
  const atRisk = open.filter((c) => c.reputationRisk >= 60);

  return (
    <div className="row">
      {patterns && (
        <div className="col-12 mb-3">
          <div className="row">
            <div className="col-6 col-md-3 mb-2">
              <div className="card"><div className="card-body py-3">
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">قيد المعالجة</p>
                <h5 className="mb-0">{patterns.open}</h5>
              </div></div>
            </div>
            <div className="col-6 col-md-3 mb-2">
              <div className={`card ${atRisk.length > 0 ? "border border-danger" : ""}`}><div className="card-body py-3">
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">خطر سمعة مرتفع</p>
                <h5 className="mb-0 text-danger">{patterns.highRisk}</h5>
              </div></div>
            </div>
            <div className="col-6 col-md-3 mb-2">
              <div className="card"><div className="card-body py-3">
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">احتُويت قبل النشر</p>
                <h5 className="mb-0">{patterns.containedPct !== null ? `${patterns.containedPct}٪` : "—"}</h5>
              </div></div>
            </div>
            <div className="col-6 col-md-3 mb-2">
              <div className="card"><div className="card-body py-3">
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">وسيط الإغلاق</p>
                <h5 className="mb-0">{patterns.medianResolutionHours !== null ? `${patterns.medianResolutionHours} ساعة` : "—"}</h5>
              </div></div>
            </div>
          </div>
        </div>
      )}

      {patterns && patterns.repeatRootCauses.length > 0 && (
        <div className="col-12 mb-3">
          <div className="card border border-warning">
            <div className="card-header pb-0">
              <h6>أسباب جذرية متكررة</h6>
              <p className="text-sm mb-0">شكوى واحدة حادثة. نفس السبب مرتين عملية معطلة — وهذه قرارات إدارة لا حالات فردية.</p>
            </div>
            <div className="card-body pt-2">
              {patterns.repeatRootCauses.map((r) => (
                <div key={r.cause} className="d-flex justify-content-between border-bottom py-2">
                  <span className="text-sm">{r.cause}</span>
                  <span className="badge badge-sm bg-gradient-warning">{r.count} مرات</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="col-12 mb-3">
          <div className="alert alert-warning text-white text-sm mb-0">{error}</div>
        </div>
      )}

      {canInvestigate && (
        <div className="col-12 mb-3">
          <div className="card">
            <div className="card-header pb-0"><h6>تسجيل شكوى وردت شفهيًا</h6></div>
            <div className="card-body pt-2 d-flex gap-2 flex-wrap">
              <input
                className="form-control form-control-sm"
                style={{ maxWidth: 460 }}
                placeholder="ما الذي قاله النزيل بالضبط؟"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
              <button
                className="btn btn-sm bg-gradient-primary mb-0"
                disabled={busy || newText.trim().length < 3}
                onClick={() => void act(async () => { await api.createComplaint(newText); setNewText(""); })}
              >
                فتح حالة
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="col-12">
        {open.length === 0 ? (
          <div className="card"><div className="card-body"><p className="text-sm text-secondary mb-0">لا توجد شكاوى مفتوحة.</p></div></div>
        ) : (
          open.map((c) => (
            <CaseCard
              key={c.id}
              kase={c}
              expanded={openId === c.id}
              canInvestigate={canInvestigate}
              canResolve={canResolve}
              busy={busy}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              onRca={(answers, rootCause) => act(() => api.recordRca(c.id, { answers, rootCause }))}
              onUpdate={(p) => act(() => api.updateComplaint(c.id, p))}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CaseCard({
  kase,
  expanded,
  canInvestigate,
  canResolve,
  busy,
  onToggle,
  onRca,
  onUpdate,
}: {
  kase: ComplaintCaseRow;
  expanded: boolean;
  canInvestigate: boolean;
  canResolve: boolean;
  busy: boolean;
  onToggle: () => void;
  onRca: (answers: Array<{ question: string; answer: string }>, rootCause: string) => void;
  onUpdate: (p: { status?: string; actions?: ComplaintAction[]; preventive?: string; resolutionNote?: string }) => void;
}) {
  const [answers, setAnswers] = useState(kase.rcaWhy ?? []);
  const [rootCause, setRootCause] = useState(kase.rootCause);
  const risky = kase.reputationRisk >= 60;

  return (
    <div className={`card mb-3 ${risky ? "border border-danger" : ""}`}>
      <div className="card-body py-3">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <span className={`badge badge-sm ${SEVERITY[kase.severity].cls}`}>{SEVERITY[kase.severity].label}</span>
            <span className="badge badge-sm bg-gradient-secondary ms-1">{CATEGORY_LABELS[kase.category] ?? kase.category}</span>
            <span className="badge badge-sm bg-gradient-dark ms-1">{STATUS_LABELS[kase.status] ?? kase.status}</span>
            {risky && <span className="badge badge-sm bg-gradient-danger ms-1">⚠ خطر نشر علني {kase.reputationRisk}٪</span>}
            <p className="text-sm mt-2 mb-0">{kase.text}</p>
            <p className="text-xs text-secondary mb-0">{new Date(kase.createdAt).toLocaleString("ar-SA")}</p>
          </div>
          <button className="btn btn-sm btn-outline-primary mb-0" onClick={onToggle}>
            {expanded ? "إخفاء" : "تحليل السبب الجذري"}
          </button>
        </div>

        {expanded && (
          <div className="border-top mt-3 pt-3">
            <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-2">الأسئلة الخمسة</p>
            {answers.map((w, i) => (
              <div key={i} className="mb-2">
                <label className="text-xs">{w.question}</label>
                <input
                  className="form-control form-control-sm"
                  value={w.answer}
                  disabled={!canInvestigate}
                  onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? { ...a, answer: e.target.value } : a)))}
                />
              </div>
            ))}
            <label className="text-xs text-uppercase text-secondary font-weight-bolder">السبب الجذري</label>
            <input
              className="form-control form-control-sm mb-2"
              placeholder="ما الذي سمح بحدوث هذا فعلًا؟"
              value={rootCause}
              disabled={!canInvestigate}
              onChange={(e) => setRootCause(e.target.value)}
            />
            {canInvestigate && (
              <button
                className="btn btn-sm bg-gradient-primary mb-3"
                disabled={busy || rootCause.trim().length < 3}
                onClick={() => onRca(answers, rootCause)}
              >
                حفظ التحليل وتوليد خطة العمل
              </button>
            )}

            {kase.actions.length > 0 && (
              <>
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-2">خطة العمل</p>
                {kase.actions.map((a, i) => (
                  <div key={i} className="d-flex align-items-center gap-2 border-bottom py-2">
                    <input
                      type="checkbox"
                      className="form-check-input mt-0"
                      checked={a.done}
                      disabled={!canInvestigate || busy}
                      onChange={() =>
                        onUpdate({ actions: kase.actions.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })
                      }
                    />
                    <div className="flex-grow-1">
                      <span className={`text-sm ${a.done ? "text-decoration-line-through text-secondary" : ""}`}>{a.action}</span>
                      <p className="text-xxs text-secondary mb-0">
                        موعد: {new Date(a.dueAt).toLocaleString("ar-SA")}
                        {!a.done && new Date(a.dueAt) < new Date() && <span className="text-danger"> · تجاوز الموعد</span>}
                      </p>
                    </div>
                  </div>
                ))}
                {canResolve && (
                  <button
                    className="btn btn-sm bg-gradient-success mt-3 mb-0"
                    disabled={busy}
                    onClick={() => onUpdate({ status: "resolved", resolutionNote: "أُغلقت بعد تنفيذ الخطة" })}
                  >
                    إغلاق الحالة
                  </button>
                )}
                {!canResolve && (
                  <p className="text-xxs text-secondary mt-2 mb-0">الإغلاق النهائي صلاحية مدير الفندق.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
