import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AgentDefinition,
  type AgentPolicyRow,
  type AgentRunRow,
  type KnowledgeItem,
  type Staff,
} from "../api/client.js";

const POLICY_LABELS: Record<string, string> = {
  enabled: "نُفّذ",
  disabled_skipped: "مُعطّل — تحويل للموظفين",
  auto_approved: "اعتماد تلقائي",
  queued_for_review: "بانتظار مراجعة بشرية",
};

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  draft: { cls: "bg-gradient-secondary", label: "مسودة" },
  approved: { cls: "bg-gradient-success", label: "معتمد" },
  retired: { cls: "bg-gradient-dark", label: "متقاعد" },
};

const MANAGER_ROLES = ["manager", "hotel_manager", "general_manager"];

/** §4 مركز الوكلاء: per-agent on/off, the approved-knowledge library the
 *  agents answer from (§6-أ), and the §9 run log. */
export function AgentCentre({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const isManager = MANAGER_ROLES.includes(staff.role);
  const [tab, setTab] = useState<"agents" | "knowledge" | "runs">("agents");
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [policies, setPolicies] = useState<AgentPolicyRow[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    api.agents().then(setAgents).catch(() => {});
    api.agentPolicies().then(setPolicies).catch(() => {});
    api.knowledge().then(setKnowledge).catch(() => {});
    api.agentRuns().then(setRuns).catch(() => {});
  }, []);
  useEffect(reload, [reload, refreshKey]);

  const enabledFor = (key: string) => policies.find((p) => p.agentKey === key)?.enabled ?? true;

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const topAgents = agents.filter((a) => a.depth === 1);

  return (
    <div className="row">
      <div className="col-12 mb-3">
        <ul className="nav nav-pills">
          {(
            [
              ["agents", "الوكلاء"],
              ["knowledge", "المعرفة المعتمدة"],
              ["runs", "سجل التشغيل"],
            ] as const
          ).map(([k, label]) => (
            <li className="nav-item" key={k}>
              <button className={`nav-link py-1 px-3 ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <div className="col-12 mb-3">
          <div className="alert alert-warning text-white text-sm mb-0">{error}</div>
        </div>
      )}

      {tab === "agents" && (
        <div className="col-12">
          <div className="row">
            {topAgents.map((a) => {
              const on = enabledFor(a.department);
              return (
                <div className="col-md-6 col-lg-4 mb-3" key={a.key}>
                  <div className={`card h-100 ${on ? "" : "opacity-6"}`}>
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <h6 className="mb-0">{a.nameAr}</h6>
                          <p className="text-xs text-secondary mb-1">{a.roleAr}</p>
                        </div>
                        <span className={`badge badge-sm ${on ? "bg-gradient-success" : "bg-gradient-secondary"}`}>
                          {on ? "يعمل" : "متوقف"}
                        </span>
                      </div>
                      <p className="text-xs mb-1">
                        <strong>النوايا:</strong> {a.handlesIntents.join("، ")}
                      </p>
                      <p className="text-xs mb-2">
                        <strong>المراجعة:</strong>{" "}
                        {a.reviewPolicy === "human_review" ? "مراجعة بشرية قبل الإرسال" : "إرسال مباشر (منخفض الخطورة)"}
                      </p>
                      {isManager && (
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            checked={on}
                            onChange={() => void act(() => api.setAgentEnabled(a.department, !on))}
                          />
                          <label className="form-check-label text-xs">
                            {on ? "إيقاف الوكيل — الرسائل تتحول للموظفين مباشرة" : "تشغيل الوكيل"}
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "knowledge" && (
        <div className="col-12">
          {isManager && <NewKnowledgeForm onCreate={(p) => act(() => api.createKnowledge(p))} />}
          <div className="card">
            <div className="card-header pb-0">
              <h6>المعرفة المعتمدة</h6>
              <p className="text-sm mb-0">الوكلاء يجيبون فقط من العناصر المعتمدة (§6-أ) — المسودة والمتقاعد لا يُستخدمان أبداً.</p>
            </div>
            <div className="card-body pt-2">
              {knowledge.length === 0 ? (
                <p className="text-sm text-secondary mb-2">لا توجد عناصر معرفة بعد.</p>
              ) : (
                knowledge.map((k) => (
                  <div key={k.id} className="border rounded-3 p-3 mb-2 d-flex justify-content-between align-items-start flex-wrap gap-2">
                    <div style={{ maxWidth: "70%" }}>
                      <span className={`badge badge-sm ${STATUS_BADGE[k.status].cls} me-2`}>{STATUS_BADGE[k.status].label}</span>
                      <strong className="text-sm">{k.title}</strong>
                      <p className="text-xs text-secondary mb-0 mt-1">{k.contentAr}</p>
                      {k.tags.length > 0 && <p className="text-xxs text-secondary mb-0">وسوم: {k.tags.join("، ")}</p>}
                    </div>
                    {isManager && (
                      <div>
                        {k.status !== "approved" && (
                          <button className="btn btn-sm bg-gradient-success mb-0 me-1" onClick={() => void act(() => api.setKnowledgeStatus(k.id, "approved"))}>
                            اعتماد
                          </button>
                        )}
                        {k.status === "approved" && (
                          <button className="btn btn-sm btn-outline-secondary mb-0" onClick={() => void act(() => api.setKnowledgeStatus(k.id, "retired"))}>
                            تقاعد
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "runs" && (
        <div className="col-12">
          <div className="card">
            <div className="card-header pb-0">
              <h6>سجل التشغيل (§9)</h6>
              <p className="text-sm mb-0">كل استدعاء وكيل: النية، السياسة المطبّقة، الزمن.</p>
            </div>
            <div className="card-body px-0 pb-2">
              <div className="table-responsive">
                <table className="table align-items-center mb-0">
                  <thead>
                    <tr>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الوكيل</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">النية</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">السياسة</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الزمن</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td className="ps-4 text-sm">{r.agentKey}</td>
                        <td className="text-sm">{r.intentType}</td>
                        <td className="text-sm">
                          <span className={`badge badge-sm ${r.policyApplied === "disabled_skipped" ? "bg-gradient-secondary" : "bg-gradient-info"}`}>
                            {POLICY_LABELS[r.policyApplied] ?? r.policyApplied}
                          </span>
                        </td>
                        <td className="text-sm">{r.durationMs}ms</td>
                        <td className="text-sm">{new Date(r.createdAt).toLocaleTimeString("ar-SA")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NewKnowledgeForm({ onCreate }: { onCreate: (p: { title: string; contentAr: string; tags?: string[] }) => Promise<void> | void }) {
  const [title, setTitle] = useState("");
  const [contentAr, setContentAr] = useState("");
  const [tags, setTags] = useState("");

  return (
    <div className="card mb-3">
      <div className="card-header pb-0">
        <h6>عنصر معرفة جديد</h6>
      </div>
      <div className="card-body pt-2">
        <div className="d-flex gap-2 flex-wrap align-items-end">
          <input className="form-control form-control-sm" style={{ maxWidth: 200 }} placeholder="العنوان (مواعيد الفطور)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="form-control form-control-sm" style={{ maxWidth: 320 }} placeholder="الإجابة بالعربية" value={contentAr} onChange={(e) => setContentAr(e.target.value)} />
          <input className="form-control form-control-sm" style={{ maxWidth: 200 }} placeholder="وسوم مفصولة بفواصل" value={tags} onChange={(e) => setTags(e.target.value)} />
          <button
            className="btn btn-sm bg-gradient-primary mb-0"
            disabled={!title || !contentAr}
            onClick={() => {
              void onCreate({ title, contentAr, tags: tags ? tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean) : [] });
              setTitle("");
              setContentAr("");
              setTags("");
            }}
          >
            إضافة كمسودة
          </button>
        </div>
      </div>
    </div>
  );
}
