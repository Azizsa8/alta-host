import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Staff, type WorkOrder } from "../api/client.js";

const PRIORITY_LABELS: Record<string, string> = {
  critical: "حرج",
  high: "مرتفع",
  normal: "عادي",
  low: "منخفض",
};
const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-gradient-danger",
  high: "bg-gradient-warning",
  normal: "bg-gradient-info",
  low: "bg-gradient-secondary",
};
const STATUS_LABELS: Record<string, string> = {
  new: "جديد",
  assigned: "مُسند",
  in_progress: "قيد التنفيذ",
  awaiting_confirm: "بانتظار التأكيد",
  closed: "مغلق",
};
const CATEGORY_LABELS: Record<string, string> = {
  electrical: "كهرباء",
  plumbing: "سباكة",
  hvac: "تكييف",
  furniture: "أثاث",
  other: "أخرى",
};

const MANAGER_ROLES = ["maintenance_manager", "hotel_manager", "general_manager", "manager", "maintenance"];

/** §6-ج / §11-5. One page, two audiences: technicians get a mobile-first
 *  card list of their own orders with status buttons and camera upload;
 *  maintenance managers get the full board with assignment and the
 *  critical-close confirmation queue. */
export function WorkOrders({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const isManager = MANAGER_ROLES.includes(staff.role);
  const isTechnician = staff.role === "technician";
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [team, setTeam] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const cameraTarget = useRef<string | null>(null);

  const reload = useCallback(() => {
    api.workOrders().then(setOrders).catch((e) => setError(String(e)));
    if (isManager) api.staffList().then(setTeam).catch(() => {});
  }, [isManager]);

  useEffect(reload, [reload, refreshKey]);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("critical close requires"))
        setError("إغلاق الأعطال الحرجة يتطلب تأكيد مدير الصيانة — أُرسل الأمر للتأكيد.");
      else setError(msg);
      reload();
    }
  }

  async function uploadPhoto(woId: string, file: File) {
    setUploadingFor(woId);
    try {
      const grant = await api.requestUpload({ kind: "fault_photo", name: file.name, mime: file.type, sizeBytes: file.size });
      const put = await fetch(grant.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`فشل رفع الصورة (${put.status})`);
      await api.confirmUpload(grant.fileId);
      await api.addWorkOrderUpdate(woId, { note: noteDrafts[woId] || "صورة من الموقع", photoFileIds: [grant.fileId] });
      setNoteDrafts((d) => ({ ...d, [woId]: "" }));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingFor(null);
    }
  }

  const open = orders.filter((o) => o.status !== "closed");
  const awaiting = open.filter((o) => o.status === "awaiting_confirm");
  const closed = orders.filter((o) => o.status === "closed");

  return (
    <div className="row">
      {/* hidden camera input shared by all cards — capture opens the phone camera */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="d-none"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && cameraTarget.current) void uploadPhoto(cameraTarget.current, f);
          e.target.value = "";
        }}
      />

      {error && (
        <div className="col-12 mb-3">
          <div className="alert alert-warning text-white text-sm mb-0">{error}</div>
        </div>
      )}

      {isManager && (
        <div className="col-12 mb-4">
          <NewOrderForm
            team={team}
            busy={creating}
            onCreate={async (payload) => {
              setCreating(true);
              await act(() => api.createWorkOrder(payload));
              setCreating(false);
            }}
          />
        </div>
      )}

      {isManager && awaiting.length > 0 && (
        <div className="col-12 mb-4">
          <div className="card border border-danger">
            <div className="card-header pb-0">
              <h6 className="text-danger">بانتظار تأكيد الإغلاق ({awaiting.length})</h6>
              <p className="text-sm mb-0">أعطال حرجة أنهاها الفني — الإغلاق النهائي قرارك (§6-ج).</p>
            </div>
            <div className="card-body pt-2">
              {awaiting.map((wo) => (
                <div key={wo.id} className="d-flex justify-content-between align-items-center border-bottom py-2">
                  <div>
                    <span className="text-sm font-weight-bold">{wo.title}</span>
                    <span className="text-xs text-secondary ms-2">{wo.location}</span>
                  </div>
                  <div>
                    <button className="btn btn-sm bg-gradient-success mb-0 me-2" onClick={() => void act(() => api.closeWorkOrder(wo.id, "تم التحقق والإغلاق"))}>
                      تأكيد الإغلاق
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary mb-0"
                      onClick={() => void act(() => api.addWorkOrderUpdate(wo.id, { note: "أُعيد للتنفيذ", statusTo: "in_progress" }))}
                    >
                      إعادة للفني
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="col-12">
        <div className="card">
          <div className="card-header pb-0">
            <h6>{isTechnician ? "أوامر العمل الخاصة بي" : "أوامر العمل"}</h6>
            <p className="text-sm mb-0">
              {isTechnician
                ? "حدّث الحالة وأرفق صور قبل/بعد من كاميرا الجوال."
                : `${open.length} مفتوح · ${closed.length} مغلق`}
            </p>
          </div>
          <div className="card-body pt-2">
            {open.length === 0 ? (
              <p className="text-sm text-secondary mb-2">لا توجد أوامر عمل مفتوحة.</p>
            ) : (
              open.map((wo) => (
                <div key={wo.id} className="border rounded-3 p-3 mb-3">
                  <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                    <div>
                      <span className={`badge badge-sm ${PRIORITY_BADGE[wo.priority]} me-2`}>{PRIORITY_LABELS[wo.priority]}</span>
                      <span className="badge badge-sm bg-gradient-dark me-2">{STATUS_LABELS[wo.status]}</span>
                      <span className="badge badge-sm bg-gradient-secondary">{CATEGORY_LABELS[wo.category] ?? wo.category}</span>
                      <h6 className="mb-0 mt-2">{wo.title}</h6>
                      <p className="text-sm text-secondary mb-1">
                        {wo.location}
                        {wo.assigneeName ? ` · الفني: ${wo.assigneeName}` : " · غير مُسند"}
                      </p>
                    </div>
                    {isManager && !wo.assigneeId && team.length > 0 && (
                      <select
                        className="form-select form-select-sm w-auto"
                        defaultValue=""
                        onChange={(e) => e.target.value && void act(() => api.assignWorkOrder(wo.id, e.target.value))}
                      >
                        <option value="" disabled>
                          إسناد إلى…
                        </option>
                        {team
                          .filter((t) => t.role === "technician" || t.role === "maintenance" || t.role === "maintenance_manager")
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>

                  {wo.updates.length > 0 && (
                    <div className="mt-2 border-top pt-2">
                      {wo.updates.slice(-3).map((u) => (
                        <p key={u.id} className="text-xs mb-1">
                          <strong>{u.authorName}:</strong> {u.note}
                          {u.photoFileIds.length > 0 && (
                            <PhotoLinks ids={u.photoFileIds} />
                          )}
                          {u.statusTo && <span className="text-secondary"> ← {STATUS_LABELS[u.statusTo]}</span>}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="d-flex gap-2 mt-2 flex-wrap align-items-center">
                    <input
                      className="form-control form-control-sm"
                      style={{ maxWidth: 280 }}
                      placeholder="ملاحظة…"
                      value={noteDrafts[wo.id] ?? ""}
                      onChange={(e) => setNoteDrafts((d) => ({ ...d, [wo.id]: e.target.value }))}
                    />
                    <button
                      className="btn btn-sm btn-outline-primary mb-0"
                      disabled={!noteDrafts[wo.id]}
                      onClick={() =>
                        void act(async () => {
                          await api.addWorkOrderUpdate(wo.id, { note: noteDrafts[wo.id] });
                          setNoteDrafts((d) => ({ ...d, [wo.id]: "" }));
                        })
                      }
                    >
                      إضافة
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary mb-0"
                      disabled={uploadingFor === wo.id}
                      onClick={() => {
                        cameraTarget.current = wo.id;
                        cameraRef.current?.click();
                      }}
                    >
                      {uploadingFor === wo.id ? "جارٍ الرفع…" : "📷 صورة"}
                    </button>
                    {(wo.status === "assigned" || wo.status === "new") && (
                      <button
                        className="btn btn-sm bg-gradient-info mb-0"
                        onClick={() => void act(() => api.addWorkOrderUpdate(wo.id, { note: "بدأ العمل", statusTo: "in_progress" }))}
                      >
                        بدء التنفيذ
                      </button>
                    )}
                    {wo.status === "in_progress" && (
                      <button
                        className="btn btn-sm bg-gradient-success mb-0"
                        onClick={() => void act(() => api.closeWorkOrder(wo.id))}
                      >
                        إنهاء وإغلاق
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoLinks({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id, i) => (
        <button
          key={id}
          className="btn btn-link text-primary text-xs mb-0 py-0 px-1"
          onClick={() => void api.fileUrl(id).then(({ url }) => window.open(url, "_blank", "noopener"))}
        >
          📎 صورة {i + 1}
        </button>
      ))}
    </>
  );
}

function NewOrderForm({
  team,
  busy,
  onCreate,
}: {
  team: Array<{ id: string; name: string; role: string }>;
  busy: boolean;
  onCreate: (p: { title: string; category: string; priority: string; location: string; assigneeId?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("plumbing");
  const [priority, setPriority] = useState("normal");
  const [location, setLocation] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>أمر عمل جديد</h6>
      </div>
      <div className="card-body pt-2">
        <div className="d-flex gap-2 flex-wrap align-items-end">
          <input className="form-control form-control-sm" style={{ maxWidth: 240 }} placeholder="الوصف (مثال: تسريب مياه)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="form-control form-control-sm" style={{ maxWidth: 140 }} placeholder="الموقع (غرفة 204)" value={location} onChange={(e) => setLocation(e.target.value)} />
          <select className="form-select form-select-sm w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="form-select form-select-sm w-auto" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">بدون إسناد</option>
            {team
              .filter((t) => t.role === "technician" || t.role === "maintenance")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <button
            className="btn btn-sm bg-gradient-primary mb-0"
            disabled={busy || !title || !location}
            onClick={() =>
              void onCreate({ title, category, priority, location, assigneeId: assigneeId || undefined }).then(() => {
                setTitle("");
                setLocation("");
                setAssigneeId("");
              })
            }
          >
            إنشاء
          </button>
        </div>
      </div>
    </div>
  );
}
