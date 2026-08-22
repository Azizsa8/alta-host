import { useCallback, useEffect, useState } from "react";
import { api, type PlatformTenant } from "../api/client.js";

const PLAN_LABELS: Record<string, string> = {
  trial: "تجريبية",
  basic: "أساسية",
  pro: "احترافية",
  enterprise: "مؤسسات",
};

/** §13: the alta_admin console — onboarding a hotel in one form, plans,
 *  quotas, and suspension. Deliberately has NO guest data anywhere (§3:
 *  the platform operator sees hotels, not their guests' conversations). */
export function PlatformAdmin({ refreshKey }: { refreshKey: number }) {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.platformTenants().then(setTenants).catch((e) => setError(String(e)));
  }, []);
  useEffect(reload, [reload, refreshKey]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (ok) setNotice(ok);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row">
      <div className="col-12 mb-4">
        <NewHotelForm busy={busy} onCreate={(p) => act(() => api.createHotel(p), `أُنشئ الفندق «${p.name}» وحساب مديره — سلّم بيانات الدخول بقناة آمنة.`)} />
      </div>

      {error && (
        <div className="col-12 mb-3">
          <div className="alert alert-warning text-white text-sm mb-0">{error}</div>
        </div>
      )}
      {notice && (
        <div className="col-12 mb-3">
          <div className="alert alert-success text-white text-sm mb-0">{notice}</div>
        </div>
      )}

      <div className="col-12">
        <div className="card">
          <div className="card-header pb-0">
            <h6>الفنادق المشتركة</h6>
            <p className="text-sm mb-0">الإيقاف يقطع وصول موظفي الفندق للمنصة فوراً — بيانات الفندق تبقى سليمة.</p>
          </div>
          <div className="card-body px-0 pb-2">
            <div className="table-responsive">
              <table className="table align-items-center mb-0">
                <thead>
                  <tr>
                    <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الفندق</th>
                    <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الباقة</th>
                    <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">التخزين</th>
                    <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">موظفون / نزلاء</th>
                    <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className={t.status === "suspended" ? "opacity-6" : ""}>
                      <td className="ps-4">
                        <span className="text-sm font-weight-bold">{t.name}</span>
                        <p className="text-xs text-secondary mb-0">{t.id}</p>
                      </td>
                      <td>
                        <select
                          className="form-select form-select-sm w-auto"
                          value={t.plan}
                          disabled={busy}
                          onChange={(e) => void act(() => api.updateTenant(t.id, { plan: e.target.value }))}
                        >
                          {Object.entries(PLAN_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-sm">
                        {t.usedPct}% من
                        <input
                          type="number"
                          className="form-control form-control-sm d-inline-block mx-1"
                          style={{ width: 70 }}
                          defaultValue={t.quotaGb}
                          disabled={busy}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v > 0 && v !== t.quotaGb) void act(() => api.updateTenant(t.id, { quotaGb: v }));
                          }}
                        />
                        GB
                      </td>
                      <td className="text-sm">
                        {t.staffCount} / {t.guestCount}
                      </td>
                      <td>
                        <span className={`badge badge-sm ${t.status === "active" ? "bg-gradient-success" : "bg-gradient-danger"}`}>
                          {t.status === "active" ? "نشط" : "موقوف"}
                        </span>
                      </td>
                      <td className="text-start pe-4">
                        {t.status === "active" ? (
                          <button
                            className="btn btn-sm btn-outline-danger mb-0"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`إيقاف «${t.name}»؟ سيفقد موظفوه الوصول فوراً.`))
                                void act(() => api.updateTenant(t.id, { status: "suspended" }));
                            }}
                          >
                            إيقاف
                          </button>
                        ) : (
                          <button className="btn btn-sm bg-gradient-success mb-0" disabled={busy} onClick={() => void act(() => api.updateTenant(t.id, { status: "active" }))}>
                            إعادة تفعيل
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewHotelForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (p: { propertyId: string; name: string; plan: string; quotaGb: number; managerName: string; managerUsername: string; managerPassword: string }) => void;
}) {
  const [propertyId, setPropertyId] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("trial");
  const [quotaGb, setQuotaGb] = useState(10);
  const [managerName, setManagerName] = useState("");
  const [managerUsername, setManagerUsername] = useState("");
  const [managerPassword, setManagerPassword] = useState("");

  const valid = /^[a-z0-9][a-z0-9-]{2,40}$/.test(propertyId) && name.length >= 2 && managerName.length >= 2 && /^[a-z0-9_.]{3,40}$/.test(managerUsername) && managerPassword.length >= 10;

  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>إضافة فندق جديد (§13)</h6>
        <p className="text-sm mb-0">خطوة واحدة: الفندق + المستأجر + حصة التخزين + حساب مدير الفندق.</p>
      </div>
      <div className="card-body pt-2">
        <div className="d-flex gap-2 flex-wrap align-items-end">
          <input className="form-control form-control-sm" style={{ maxWidth: 160 }} placeholder="المعرّف (hotel-slug)" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} dir="ltr" />
          <input className="form-control form-control-sm" style={{ maxWidth: 180 }} placeholder="اسم الفندق" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="form-select form-select-sm w-auto" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {Object.entries(PLAN_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <div className="d-flex align-items-center gap-1">
            <input type="number" className="form-control form-control-sm" style={{ width: 70 }} value={quotaGb} onChange={(e) => setQuotaGb(Number(e.target.value))} />
            <span className="text-xs">GB</span>
          </div>
          <input className="form-control form-control-sm" style={{ maxWidth: 150 }} placeholder="اسم المدير" value={managerName} onChange={(e) => setManagerName(e.target.value)} />
          <input className="form-control form-control-sm" style={{ maxWidth: 140 }} placeholder="username" value={managerUsername} onChange={(e) => setManagerUsername(e.target.value)} dir="ltr" />
          <input type="password" className="form-control form-control-sm" style={{ maxWidth: 160 }} placeholder="كلمة مرور (١٠+ أحرف)" value={managerPassword} onChange={(e) => setManagerPassword(e.target.value)} />
          <button
            className="btn btn-sm bg-gradient-primary mb-0"
            disabled={busy || !valid}
            onClick={() => {
              onCreate({ propertyId, name, plan, quotaGb, managerName, managerUsername, managerPassword });
              setManagerPassword("");
            }}
          >
            إنشاء الفندق
          </button>
        </div>
      </div>
    </div>
  );
}
