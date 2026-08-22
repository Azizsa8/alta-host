import { useCallback, useEffect, useState } from "react";
import { api, type BrandProfile, type ContentItemRow, type Staff } from "../api/client.js";

const CHANNEL_LABELS: Record<string, string> = { instagram: "إنستغرام", facebook: "فيسبوك", tiktok: "تيك توك" };
const STATUS_META: Record<string, { label: string; cls: string }> = {
  idea: { label: "فكرة", cls: "bg-gradient-secondary" },
  draft: { label: "مسودة", cls: "bg-gradient-info" },
  in_review: { label: "قيد المراجعة", cls: "bg-gradient-warning" },
  approved: { label: "معتمد", cls: "bg-gradient-primary" },
  scheduled: { label: "مجدول", cls: "bg-gradient-dark" },
  published: { label: "منشور", cls: "bg-gradient-success" },
  failed: { label: "فشل النشر", cls: "bg-gradient-danger" },
  rejected: { label: "مرفوض", cls: "bg-gradient-secondary" },
};

const EDIT_ROLES = ["manager", "hotel_manager", "general_manager", "marketing_manager"];

/** §4 استوديو المحتوى: brand profile → ideas → drafts → approval →
 *  schedule → publish, with the §7 human gate everywhere it matters. */
export function ContentStudio({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const canEdit = EDIT_ROLES.includes(staff.role);
  const [tab, setTab] = useState<"board" | "brand">("board");
  const [items, setItems] = useState<ContentItemRow[]>([]);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [brand, setBrand] = useState<BrandProfile | null>(null);
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.contentItems().then(setItems).catch((e) => setError(String(e)));
    api.brandProfile().then(setBrand).catch(() => {});
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

  return (
    <div className="row">
      <div className="col-12 mb-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
        <ul className="nav nav-pills">
          {(
            [
              ["board", "لوحة المحتوى"],
              ["brand", "هوية العلامة"],
            ] as const
          ).map(([k, label]) => (
            <li className="nav-item" key={k}>
              <button className={`nav-link py-1 px-3 ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
                {label}
              </button>
            </li>
          ))}
        </ul>
        {tab === "board" && canEdit && (
          <button className="btn btn-sm bg-gradient-primary mb-0" disabled={busy} onClick={() => void act(async () => setIdeas((await api.contentIdeas()).ideas))}>
            💡 توليد أفكار من هوية العلامة
          </button>
        )}
      </div>

      {error && (
        <div className="col-12 mb-3">
          <div className="alert alert-warning text-white text-sm mb-0">{error}</div>
        </div>
      )}

      {tab === "brand" && brand && (
        <div className="col-12">
          <BrandEditor brand={brand} canEdit={canEdit} onSave={(p) => act(() => api.saveBrandProfile(p))} />
        </div>
      )}

      {tab === "board" && (
        <>
          {ideas.length > 0 && (
            <div className="col-12 mb-3">
              <div className="card">
                <div className="card-header pb-0">
                  <h6>أفكار مقترحة</h6>
                  <p className="text-sm mb-0">اختر الفكرة والقناة — تُنشأ مسودة جاهزة للتحرير.</p>
                </div>
                <div className="card-body pt-2">
                  {ideas.map((idea, i) => (
                    <div key={i} className="d-flex justify-content-between align-items-center border-bottom py-2 flex-wrap gap-2">
                      <span className="text-sm">{idea}</span>
                      <div className="d-flex gap-1">
                        {Object.entries(CHANNEL_LABELS).map(([ch, label]) => (
                          <button
                            key={ch}
                            className="btn btn-xs btn-outline-primary mb-0 py-1 px-2 text-xs"
                            disabled={busy}
                            onClick={() => void act(async () => { await api.createContent({ idea, channel: ch }); setIdeas((arr) => arr.filter((_, j) => j !== i)); })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="col-12">
            {items.length === 0 ? (
              <div className="card"><div className="card-body"><p className="text-sm text-secondary mb-0">لا يوجد محتوى بعد — ولّد أفكاراً وابدأ.</p></div></div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="card mb-3">
                  <div className="card-body py-3">
                    <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                      <div>
                        <span className={`badge badge-sm ${STATUS_META[item.status]?.cls}`}>{STATUS_META[item.status]?.label}</span>
                        <span className="badge badge-sm bg-gradient-secondary ms-1">{CHANNEL_LABELS[item.channel]}</span>
                        <h6 className="mb-0 mt-2 text-sm">{item.idea}</h6>
                      </div>
                      {item.status === "published" && item.resultUrl && (
                        <a className="text-xs text-success" href={item.resultUrl} target="_blank" rel="noopener">
                          ✓ منشور — رابط النتيجة
                        </a>
                      )}
                      {item.status === "scheduled" && item.scheduledAt && (
                        <span className="text-xs text-secondary">مجدول: {new Date(item.scheduledAt).toLocaleString("ar-SA")}</span>
                      )}
                    </div>

                    {item.status !== "published" && canEdit ? (
                      <textarea
                        className="form-control form-control-sm mt-2"
                        rows={3}
                        value={bodyDrafts[item.id] ?? item.bodyAr}
                        onChange={(e) => setBodyDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                        onBlur={() => {
                          const v = bodyDrafts[item.id];
                          if (v !== undefined && v !== item.bodyAr) void act(() => api.editContent(item.id, { bodyAr: v }));
                        }}
                      />
                    ) : (
                      <p className="text-sm text-secondary mt-2 mb-0" style={{ whiteSpace: "pre-line" }}>{item.bodyAr}</p>
                    )}

                    {canEdit && (
                      <div className="d-flex gap-2 mt-2 flex-wrap">
                        {item.status === "draft" && (
                          <button className="btn btn-sm bg-gradient-warning mb-0" disabled={busy} onClick={() => void act(() => api.transitionContent(item.id, "in_review"))}>
                            إرسال للمراجعة
                          </button>
                        )}
                        {item.status === "in_review" && (
                          <>
                            <button className="btn btn-sm bg-gradient-primary mb-0" disabled={busy} onClick={() => void act(() => api.transitionContent(item.id, "approved"))}>
                              اعتماد
                            </button>
                            <button className="btn btn-sm btn-outline-danger mb-0" disabled={busy} onClick={() => void act(() => api.transitionContent(item.id, "rejected"))}>
                              رفض
                            </button>
                          </>
                        )}
                        {item.status === "approved" && (
                          <>
                            <button className="btn btn-sm bg-gradient-success mb-0" disabled={busy} onClick={() => void act(() => api.publishContent(item.id))}>
                              نشر الآن
                            </button>
                            <button
                              className="btn btn-sm btn-outline-primary mb-0"
                              disabled={busy}
                              onClick={() => void act(() => api.transitionContent(item.id, "scheduled", new Date(Date.now() + 3600_000).toISOString()))}
                            >
                              جدولة بعد ساعة
                            </button>
                          </>
                        )}
                        {item.status === "failed" && (
                          <button className="btn btn-sm bg-gradient-warning mb-0" disabled={busy} onClick={() => void act(() => api.transitionContent(item.id, "scheduled", new Date().toISOString()))}>
                            إعادة المحاولة
                          </button>
                        )}
                        {item.status === "rejected" && (
                          <button className="btn btn-sm btn-outline-secondary mb-0" disabled={busy} onClick={() => void act(() => api.transitionContent(item.id, "draft"))}>
                            إعادة للمسودة
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BrandEditor({ brand, canEdit, onSave }: { brand: BrandProfile; canEdit: boolean; onSave: (p: Partial<BrandProfile>) => void }) {
  const [identity, setIdentity] = useState(brand.identity);
  const [services, setServices] = useState(brand.services.join("، "));
  const [offers, setOffers] = useState(brand.offers.join("، "));
  const [audience, setAudience] = useState(brand.audience);

  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>هوية العلامة (§6-هـ)</h6>
        <p className="text-sm mb-0">كل الأفكار والمسودات تتولد من هذه الهوية — كلما كانت أدق كان المحتوى أصدق.</p>
      </div>
      <div className="card-body pt-2">
        <label className="text-xs text-secondary">من نحن</label>
        <input className="form-control form-control-sm mb-2" value={identity} onChange={(e) => setIdentity(e.target.value)} disabled={!canEdit} />
        <label className="text-xs text-secondary">الخدمات (مفصولة بفواصل)</label>
        <input className="form-control form-control-sm mb-2" value={services} onChange={(e) => setServices(e.target.value)} disabled={!canEdit} />
        <label className="text-xs text-secondary">العروض الحالية</label>
        <input className="form-control form-control-sm mb-2" value={offers} onChange={(e) => setOffers(e.target.value)} disabled={!canEdit} />
        <label className="text-xs text-secondary">الجمهور المستهدف</label>
        <input className="form-control form-control-sm mb-2" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={!canEdit} />
        {canEdit && (
          <button
            className="btn btn-sm bg-gradient-primary mb-0"
            onClick={() =>
              onSave({
                identity,
                audience,
                services: services.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
                offers: offers.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
              })
            }
          >
            حفظ الهوية
          </button>
        )}
      </div>
    </div>
  );
}
