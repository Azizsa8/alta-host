import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type BrandKitData,
  type BrandRenderRow,
  type PhotoLayoutSpec,
  type SocialAnalytics,
  type SocialChannelRow,
  type Staff,
  type VideoStepSpec,
} from "../api/client.js";
import { ChannelLogo } from "../components/ChannelLogo.js";

/* The workspace answers two questions in order — which channel, then what
   about it — because every mode below means something different per
   channel. Picking the mode first would force a channel switcher inside
   all five. */
type Mode = "analytics" | "reports" | "generator" | "inquiries" | "status";

const MODES: Array<{ key: Mode; label: string; icon: string; hint: string }> = [
  { key: "analytics", label: "التحليلات", icon: "insights", hint: "متابعون، وصول، تفاعل" },
  { key: "reports", label: "التقارير", icon: "summarize", hint: "تقرير القناة وإرساله" },
  { key: "generator", label: "مولّد المحتوى", icon: "auto_awesome", hint: "الهوية والصور والفيديو" },
  { key: "inquiries", label: "استفسارات المتابعين", icon: "forum", hint: "رسائل وتعليقات" },
  { key: "status", label: "حالة الصفحة", icon: "monitor_heart", hint: "الربط والصلاحيات" },
];

const MANAGE_ROLES = ["manager", "hotel_manager", "general_manager", "marketing_manager"];

export function ChannelWorkspace({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const canManage = MANAGE_ROLES.includes(staff.role);
  const [channels, setChannels] = useState<SocialChannelRow[]>([]);
  const [channelKey, setChannelKey] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("analytics");
  const [analytics, setAnalytics] = useState<SocialAnalytics | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    api.socialChannels().then(setChannels).catch((e) => setError(String(e)));
    api.socialAnalytics().then(setAnalytics).catch(() => {});
  }, []);
  useEffect(reload, [reload, refreshKey]);

  const channel = channels.find((c) => c.key === channelKey) ?? null;

  /* ── step 1: choose a channel ────────────────────────────────────── */
  if (!channel) {
    const enabled = channels.filter((c) => c.enabled);
    const rest = channels.filter((c) => !c.enabled);
    return (
      <div className="row">
        <div className="col-12 mb-3">
          <h5 className="mb-1">اختر القناة</h5>
          <p className="text-sm text-secondary mb-0">
            كل ما بعد هذه الخطوة يخص القناة التي تختارها — تحليلاتها، تقاريرها، هوية محتواها، واستفساراتها.
          </p>
        </div>
        {[
          { title: "قنواتك المفعّلة", list: enabled },
          { title: "قنوات متاحة", list: rest },
        ].map(
          (group) =>
            group.list.length > 0 && (
              <div className="col-12 mb-2" key={group.title}>
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-2">{group.title}</p>
                <div className="row">
                  {group.list.map((c) => (
                    <div className="col-6 col-md-4 col-xl-3 mb-2" key={c.key}>
                      <button
                        className={`hs-channel-tile ${c.enabled ? "" : "is-off"}`}
                        onClick={() => setChannelKey(c.key)}
                      >
                        <ChannelLogo channel={c.key} size={34} />
                        <span className="hs-channel-tile-name">{c.nameAr}</span>
                        <span className="hs-channel-tile-meta">
                          {c.connected ? "● موصولة" : c.enabled ? "مفعّلة" : "متوقفة"}
                          {c.followers > 0 ? ` · ${c.followers.toLocaleString("ar-SA")} متابع` : ""}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
        )}
        {error && <div className="col-12"><div className="alert alert-warning text-white text-sm">{error}</div></div>}
      </div>
    );
  }

  /* ── step 2: what about this channel ─────────────────────────────── */
  const perChannel = analytics?.perChannel.find((p) => p.channel === channel.key);

  return (
    <div className="row">
      <div className="col-12 mb-3">
        <div className="hs-channel-head">
          <button className="btn btn-sm btn-outline-secondary mb-0" onClick={() => setChannelKey(null)}>
            ← القنوات
          </button>
          <ChannelLogo channel={channel.key} size={38} />
          <div className="flex-grow-1">
            <h5 className="mb-0">{channel.nameAr}</h5>
            <p className="text-xs text-secondary mb-0">
              {channel.accountRef || channel.handle || channel.name}
              {channel.connected ? " · موصولة" : " · غير موصولة"}
            </p>
          </div>
        </div>
      </div>

      <div className="col-12 mb-3">
        <div className="hs-modebar">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`hs-mode ${mode === m.key ? "is-active" : ""}`}
              onClick={() => setMode(m.key)}
            >
              <i className="material-icons-round">{m.icon}</i>
              <span className="hs-mode-label">{m.label}</span>
              <span className="hs-mode-hint">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="col-12">
        {mode === "analytics" && <AnalyticsMode channel={channel} row={perChannel} />}
        {mode === "reports" && <ReportsMode channel={channel} row={perChannel} />}
        {mode === "generator" && <GeneratorMode channel={channel} canManage={canManage} />}
        {mode === "inquiries" && <InquiriesMode channel={channel} />}
        {mode === "status" && <StatusMode channel={channel} />}
      </div>
    </div>
  );
}

/* ── analytics ──────────────────────────────────────────────────────── */
function AnalyticsMode({
  channel,
  row,
}: {
  channel: SocialChannelRow;
  row?: SocialAnalytics["perChannel"][number];
}) {
  if (!channel.enabled) {
    return <EmptyNote text="فعّل القناة أولًا لعرض تحليلاتها." />;
  }
  const tiles = [
    { label: "متابعون", value: (row?.followers ?? channel.followers).toLocaleString("ar-SA") },
    { label: "وصول ٣٠ يومًا", value: (row?.reach30d ?? channel.reach30d).toLocaleString("ar-SA") },
    { label: "معدل التفاعل", value: row?.engagementRate !== null && row?.engagementRate !== undefined ? `${row.engagementRate}٪` : "—" },
    { label: "نُشر ٣٠ يومًا", value: String(row?.published30d ?? 0) },
  ];
  return (
    <>
      <div className="row mb-3">
        {tiles.map((t) => (
          <div className="col-6 col-md-3 mb-2" key={t.label}>
            <div className="card"><div className="card-body py-3">
              <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">{t.label}</p>
              <h5 className="mb-0 hs-metric">{t.value}</h5>
            </div></div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-body py-3">
          <p className="text-sm mb-1">
            آخر مزامنة: {row?.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString("ar-SA") : "لم تُزامن بعد"}
          </p>
          <p className="text-xs text-secondary mb-0">
            الأرقام كما أبلغت عنها المنصة في آخر مزامنة — تُعرض بتاريخها ولا تُقدَّر.
          </p>
        </div>
      </div>
    </>
  );
}

/* ── reports ────────────────────────────────────────────────────────── */
function ReportsMode({
  channel,
  row,
}: {
  channel: SocialChannelRow;
  row?: SocialAnalytics["perChannel"][number];
}) {
  const [sent, setSent] = useState("");
  const report = useMemo(
    () =>
      [
        `تقرير قناة ${channel.nameAr}`,
        `الحساب: ${channel.accountRef || channel.handle || "—"}`,
        `المتابعون: ${(row?.followers ?? channel.followers).toLocaleString("ar-SA")}`,
        `الوصول (٣٠ يومًا): ${(row?.reach30d ?? channel.reach30d).toLocaleString("ar-SA")}`,
        `التفاعل: ${row?.engagementRate ?? "—"}٪`,
        `منشورات (٣٠ يومًا): ${row?.published30d ?? 0}`,
        `الوتيرة المستهدفة: ${channel.postsPerWeek} أسبوعيًا`,
        `الحالة: ${channel.connected ? "موصولة" : "غير موصولة"}`,
      ].join("\n"),
    [channel, row]
  );

  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>تقرير القناة</h6>
        <p className="text-sm mb-0">مبني من أرقام هذه القناة وحدها — جاهز للنسخ أو الإرسال.</p>
      </div>
      <div className="card-body pt-2">
        <pre className="hs-report">{report}</pre>
        <div className="d-flex gap-2 flex-wrap">
          <button
            className="btn btn-sm bg-gradient-primary mb-0"
            onClick={() => {
              void navigator.clipboard?.writeText(report);
              setSent("نُسخ التقرير — الصقه في واتساب أو البريد.");
            }}
          >
            نسخ التقرير
          </button>
          <a
            className="btn btn-sm btn-outline-primary mb-0"
            href={`https://wa.me/?text=${encodeURIComponent(report)}`}
            target="_blank"
            rel="noopener"
          >
            إرسال عبر واتساب
          </a>
          <a
            className="btn btn-sm btn-outline-secondary mb-0"
            href={`mailto:?subject=${encodeURIComponent(`تقرير ${channel.nameAr}`)}&body=${encodeURIComponent(report)}`}
          >
            إرسال بالبريد
          </a>
        </div>
        {sent && <p className="text-xs text-success mt-2 mb-0">{sent}</p>}
      </div>
    </div>
  );
}

/* ── followers inquiries ────────────────────────────────────────────── */
function InquiriesMode({ channel }: { channel: SocialChannelRow }) {
  if (!channel.connected) {
    return (
      <EmptyNote
        text={`اربط ${channel.nameAr} أولًا — سحب الرسائل والتعليقات يحتاج صلاحية من المنصة نفسها، ولا نعرض استفسارات لا نملك مصدرها.`}
      />
    );
  }
  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>استفسارات المتابعين</h6>
        <p className="text-sm mb-0">الرسائل والتعليقات الواردة من {channel.nameAr}.</p>
      </div>
      <div className="card-body pt-2">
        <p className="text-sm text-secondary mb-0">
          لا توجد استفسارات جديدة. الوارد الجديد يظهر هنا وفي صندوق الرسائل معًا.
        </p>
      </div>
    </div>
  );
}

/* ── page status ────────────────────────────────────────────────────── */
function StatusMode({ channel }: { channel: SocialChannelRow }) {
  const rows: Array<[string, string, boolean]> = [
    ["الربط", channel.connected ? "موصولة" : "غير موصولة", channel.connected],
    ["النشر الآلي", channel.autoPublish ? "مفعّل" : "متوقف (يحتاج اعتمادك)", true],
    ["نشر الوكيل", channel.agent.canPublish ? "مسموح" : channel.agent.blockedReasonAr, channel.agent.canPublish],
    ["الرد على التقييمات", channel.agent.canReply ? "مسموح" : "غير متاح لهذه القناة", channel.agent.canReply],
    ["قراءة التحليلات", channel.agent.canReadAnalytics ? "مسموح" : "يحتاج ربطًا", channel.agent.canReadAnalytics],
    ["الوتيرة", `${channel.postsPerWeek} منشور أسبوعيًا`, true],
    ["حد النص", `${channel.maxChars} حرف`, true],
  ];
  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>حالة الصفحة</h6>
        <p className="text-sm mb-0">ما تستطيع المنصة فعله على {channel.nameAr} الآن — لا ما تتمناه.</p>
      </div>
      <div className="card-body pt-2">
        {rows.map(([label, value, ok]) => (
          <div key={label} className="d-flex justify-content-between align-items-center border-bottom py-2">
            <span className="text-sm">{label}</span>
            <span className={`text-sm ${ok ? "text-success" : "text-secondary"}`}>{value}</span>
          </div>
        ))}
        {channel.connectionError && <p className="text-xs text-danger mt-2 mb-0">{channel.connectionError}</p>}
      </div>
    </div>
  );
}

/* ── content generator: branding → photo layout → video sequence ────── */
function GeneratorMode({ channel, canManage }: { channel: SocialChannelRow; canManage: boolean }) {
  const [step, setStep] = useState<"brand" | "photo" | "video" | "output">("brand");
  const [kit, setKit] = useState<BrandKitData | null>(null);
  const [renders, setRenders] = useState<BrandRenderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);

  const reload = useCallback(() => {
    api.brandKit().then(setKit).catch((e) => setError(String(e)));
    api.brandRenders(channel.key).then(setRenders).catch(() => {});
  }, [channel.key]);
  useEffect(reload, [reload]);

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

  if (!kit) return <p className="text-sm text-secondary">جارٍ التحميل…</p>;

  const canvas = kit.canvases[channel.key] ?? { w: 1080, h: 1080, label: "1:1" };
  const layout: PhotoLayoutSpec = kit.photoLayout[channel.key] ?? {
    anchor: "bottom-right",
    scalePct: 18,
    marginPct: 5,
    opacity: 0.9,
    scrim: false,
  };

  const STEPS: Array<[typeof step, string]> = [
    ["brand", "١ · الهوية"],
    ["photo", "٢ · توزيع الهوية على الصور"],
    ["video", "٣ · تسلسل الهوية في الفيديو"],
    ["output", "٤ · الإنتاج"],
  ];

  return (
    <>
      <div className="hs-steps mb-3">
        {STEPS.map(([k, label]) => (
          <button key={k} className={`hs-step ${step === k ? "is-active" : ""}`} onClick={() => setStep(k)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-warning text-white text-sm">{error}</div>}

      {step === "brand" && (
        <BrandStep kit={kit} canManage={canManage} busy={busy} onSave={(p) => act(() => api.saveBrandKit(p))} />
      )}
      {step === "photo" && (
        <PhotoLayoutStep
          channel={channel}
          canvas={canvas}
          layout={layout}
          kit={kit}
          canManage={canManage}
          busy={busy}
          onSave={(next) =>
            act(() => api.saveBrandKit({ photoLayout: { ...kit.photoLayout, [channel.key]: next } }))
          }
        />
      )}
      {step === "video" && (
        <VideoSequenceStep
          sequence={kit.videoSequence}
          canManage={canManage}
          busy={busy}
          onSave={(seq) => act(() => api.saveBrandKit({ videoSequence: seq }))}
        />
      )}
      {step === "output" && (
        <OutputStep
          channel={channel}
          renders={renders}
          photoIds={photoIds}
          setPhotoIds={setPhotoIds}
          busy={busy}
          canManage={canManage}
          onRenderPhoto={() => act(() => api.renderPhoto(channel.key, photoIds))}
          onRenderVideo={() => act(() => api.renderVideo(channel.key, photoIds))}
        />
      )}
    </>
  );
}

function BrandStep({
  kit,
  canManage,
  busy,
  onSave,
}: {
  kit: BrandKitData;
  canManage: boolean;
  busy: boolean;
  onSave: (p: Partial<BrandKitData>) => void;
}) {
  const [wordmark, setWordmark] = useState(kit.wordmark);
  const [primary, setPrimary] = useState(kit.primaryColor);
  const [secondary, setSecondary] = useState(kit.secondaryColor);
  const [ink, setInk] = useState(kit.inkColor);
  const [uploading, setUploading] = useState(false);

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const grant = await api.requestUpload({
        kind: "post_image",
        name: file.name,
        mime: file.type,
        sizeBytes: file.size,
      });
      const put = await fetch(grant.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`فشل رفع الشعار (${put.status})`);
      await api.confirmUpload(grant.fileId);
      onSave({ logoFileId: grant.fileId });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>هوية العلامة</h6>
        <p className="text-sm mb-0">تُطبَّق على كل صورة وفيديو ينتجه المولّد — تُضبط مرة وتُستخدم في كل القنوات.</p>
      </div>
      <div className="card-body pt-2">
        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="text-xs">الاسم التجاري</label>
            <input className="form-control form-control-sm mb-3" value={wordmark} disabled={!canManage} onChange={(e) => setWordmark(e.target.value)} />

            <label className="text-xs">الشعار (PNG بخلفية شفافة يعطي أفضل نتيجة)</label>
            <div className="d-flex align-items-center gap-2 mb-3">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="form-control form-control-sm"
                disabled={!canManage || uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadLogo(f);
                  e.target.value = "";
                }}
              />
              {kit.logoFileId && <span className="badge badge-sm bg-gradient-success">مرفوع</span>}
            </div>

            <div className="d-flex gap-3 flex-wrap">
              {([
                ["اللون الأساسي", primary, setPrimary],
                ["اللون الثانوي", secondary, setSecondary],
                ["لون الحبر", ink, setInk],
              ] as const).map(([label, value, set]) => (
                <div key={label}>
                  <label className="text-xs d-block">{label}</label>
                  <input type="color" className="hs-color" value={value} disabled={!canManage} onChange={(e) => set(e.target.value)} />
                  <span className="text-xxs text-secondary d-block mono">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="col-md-6 mb-3">
            <label className="text-xs d-block mb-2">معاينة</label>
            <div className="hs-brand-preview" style={{ background: ink }}>
              <div className="hs-brand-chip" style={{ background: primary }} />
              <span style={{ color: "#fff", fontWeight: 600, fontSize: 20 }}>{wordmark || "اسم الفندق"}</span>
              <div className="hs-brand-rule" style={{ background: secondary }} />
            </div>
          </div>
        </div>

        {canManage && (
          <button
            className="btn btn-sm bg-gradient-primary mb-0"
            disabled={busy}
            onClick={() => onSave({ wordmark, primaryColor: primary, secondaryColor: secondary, inkColor: ink })}
          >
            حفظ الهوية
          </button>
        )}
      </div>
    </div>
  );
}

const ANCHOR_GRID = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];

function PhotoLayoutStep({
  channel,
  canvas,
  layout,
  kit,
  canManage,
  busy,
  onSave,
}: {
  channel: SocialChannelRow;
  canvas: { w: number; h: number; label: string };
  layout: PhotoLayoutSpec;
  kit: BrandKitData;
  canManage: boolean;
  busy: boolean;
  onSave: (l: PhotoLayoutSpec) => void;
}) {
  const [draft, setDraft] = useState<PhotoLayoutSpec>(layout);
  useEffect(() => setDraft(layout), [layout, channel.key]);

  // Preview box mirrors the channel's real aspect ratio so what you place
  // is what renders — a square preview would lie about a 9:16 story.
  const ratio = canvas.w / canvas.h;
  const previewW = ratio >= 1 ? 300 : 300 * ratio;
  const previewH = ratio >= 1 ? 300 / ratio : 300;
  const [v, h] = draft.anchor.split("-");
  const marginPx = (Math.min(previewW, previewH) * draft.marginPct) / 100;
  const markW = (previewW * draft.scalePct) / 100;

  return (
    <div className="card">
      <div className="card-header pb-0">
        <h6>توزيع الهوية على الصور — {channel.nameAr}</h6>
        <p className="text-sm mb-0">
          المقاس {canvas.label} ({canvas.w}×{canvas.h}). لكل قناة توزيعها: المساحة الآمنة في ستوري ٩:١٦ ليست نفسها في منشور مربّع.
        </p>
      </div>
      <div className="card-body pt-2">
        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="text-xs d-block mb-2">موضع الشعار</label>
            <div className="hs-anchor-grid mb-3">
              {ANCHOR_GRID.map((a) => (
                <button
                  key={a}
                  className={`hs-anchor ${draft.anchor === a ? "is-active" : ""}`}
                  disabled={!canManage}
                  onClick={() => setDraft({ ...draft, anchor: a })}
                  aria-label={a}
                />
              ))}
            </div>

            {([
              ["الحجم", "scalePct", 4, 60, "٪ من العرض"],
              ["الهامش", "marginPct", 0, 25, "٪ من الضلع الأقصر"],
            ] as const).map(([label, key, min, max, unit]) => (
              <div key={key} className="mb-2">
                <label className="text-xs d-flex justify-content-between">
                  <span>{label}</span>
                  <span className="mono">{draft[key]}{unit}</span>
                </label>
                <input
                  type="range"
                  className="form-range"
                  min={min}
                  max={max}
                  value={draft[key] as number}
                  disabled={!canManage}
                  onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                />
              </div>
            ))}
            <div className="mb-3">
              <label className="text-xs d-flex justify-content-between">
                <span>الشفافية</span>
                <span className="mono">{Math.round(draft.opacity * 100)}٪</span>
              </label>
              <input
                type="range"
                className="form-range"
                min={10}
                max={100}
                value={Math.round(draft.opacity * 100)}
                disabled={!canManage}
                onChange={(e) => setDraft({ ...draft, opacity: Number(e.target.value) / 100 })}
              />
            </div>
            {canManage && (
              <button className="btn btn-sm bg-gradient-primary mb-0" disabled={busy} onClick={() => onSave(draft)}>
                حفظ توزيع {channel.nameAr}
              </button>
            )}
          </div>

          <div className="col-md-6">
            <label className="text-xs d-block mb-2">معاينة بالمقاس الحقيقي</label>
            <div className="hs-canvas" style={{ width: previewW, height: previewH }}>
              <div
                className="hs-canvas-mark"
                style={{
                  width: markW,
                  opacity: draft.opacity,
                  background: kit.primaryColor,
                  insetInlineStart: h === "left" ? marginPx : h === "right" ? "auto" : "50%",
                  insetInlineEnd: h === "right" ? marginPx : "auto",
                  top: v === "top" ? marginPx : v === "bottom" ? "auto" : "50%",
                  bottom: v === "bottom" ? marginPx : "auto",
                  transform: `${h === "center" ? "translateX(-50%)" : ""} ${v === "middle" ? "translateY(-50%)" : ""}`,
                }}
              >
                {kit.wordmark ? kit.wordmark.slice(0, 14) : "الشعار"}
              </div>
            </div>
            <p className="text-xxs text-secondary mt-2 mb-0">
              الإطار بنسبة القناة نفسها — ما تضعه هنا هو ما يُركَّب فعليًا عند الإنتاج.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const STEP_LABELS: Record<VideoStepSpec["kind"], { label: string; hint: string }> = {
  intro: { label: "بطاقة افتتاح", hint: "شعار على لون الحبر" },
  shot: { label: "لقطة", hint: "حركة بطيئة على صورة" },
  watermark: { label: "علامة مائية", hint: "تُحمل عبر كل اللقطات" },
  outro: { label: "بطاقة ختام", hint: "دعوة للحجز باللون الأساسي" },
};

function VideoSequenceStep({
  sequence,
  canManage,
  busy,
  onSave,
}: {
  sequence: VideoStepSpec[];
  canManage: boolean;
  busy: boolean;
  onSave: (s: VideoStepSpec[]) => void;
}) {
  const [steps, setSteps] = useState<VideoStepSpec[]>(sequence);
  useEffect(() => setSteps(sequence), [sequence]);

  const total = steps.filter((s) => s.kind !== "watermark").reduce((a, s) => a + (s.seconds || 0), 0);

  function move(i: number, dir: -1 | 1) {
    const next = [...steps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  }

  return (
    <div className="card">
      <div className="card-header pb-0 d-flex justify-content-between align-items-start">
        <div>
          <h6>تسلسل الهوية في الفيديو</h6>
          <p className="text-sm mb-0">ترتيب ظهور علامتك عبر الفيديو، والمدة لكل خطوة.</p>
        </div>
        <span className="badge badge-sm bg-gradient-dark">المدة {total.toFixed(1)} ثانية</span>
      </div>
      <div className="card-body pt-2">
        {steps.map((s, i) => (
          <div key={i} className="hs-seq-row">
            <span className="hs-seq-index mono">{i + 1}</span>
            <div className="flex-grow-1">
              <span className="text-sm">{STEP_LABELS[s.kind].label}</span>
              <span className="text-xxs text-secondary d-block">{STEP_LABELS[s.kind].hint}</span>
            </div>
            {s.kind !== "watermark" && (
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="10"
                className="form-control form-control-sm"
                style={{ width: 78 }}
                value={s.seconds}
                disabled={!canManage}
                onChange={(e) =>
                  setSteps(steps.map((x, j) => (j === i ? { ...x, seconds: Number(e.target.value) } : x)))
                }
              />
            )}
            {canManage && (
              <div className="d-flex gap-1">
                <button className="btn btn-sm btn-outline-secondary mb-0 py-0 px-2" onClick={() => move(i, -1)}>↑</button>
                <button className="btn btn-sm btn-outline-secondary mb-0 py-0 px-2" onClick={() => move(i, 1)}>↓</button>
                <button
                  className="btn btn-sm btn-outline-danger mb-0 py-0 px-2"
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}

        {canManage && (
          <div className="d-flex gap-2 flex-wrap mt-3">
            {(["intro", "shot", "watermark", "outro"] as const).map((k) => (
              <button
                key={k}
                className="btn btn-sm btn-outline-primary mb-0"
                onClick={() => setSteps([...steps, { kind: k, seconds: k === "watermark" ? 0 : 2 }])}
              >
                + {STEP_LABELS[k].label}
              </button>
            ))}
            <button className="btn btn-sm bg-gradient-primary mb-0" disabled={busy} onClick={() => onSave(steps)}>
              حفظ التسلسل
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OutputStep({
  channel,
  renders,
  photoIds,
  setPhotoIds,
  busy,
  canManage,
  onRenderPhoto,
  onRenderVideo,
}: {
  channel: SocialChannelRow;
  renders: BrandRenderRow[];
  photoIds: string[];
  setPhotoIds: (ids: string[]) => void;
  busy: boolean;
  canManage: boolean;
  onRenderPhoto: () => void;
  onRenderVideo: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");

  async function addPhotos(files: FileList) {
    setUploading(true);
    setNote("");
    try {
      const ids: string[] = [];
      for (const file of Array.from(files).slice(0, 6)) {
        const grant = await api.requestUpload({
          kind: "content_media",
          name: file.name,
          mime: file.type,
          sizeBytes: file.size,
        });
        const put = await fetch(grant.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) continue;
        await api.confirmUpload(grant.fileId);
        ids.push(grant.fileId);
      }
      setPhotoIds([...photoIds, ...ids]);
      setNote(`${ids.length} صورة جاهزة للإنتاج`);
    } finally {
      setUploading(false);
    }
  }

  async function open(fileId: string) {
    const { url } = await api.fileUrl(fileId);
    window.open(url, "_blank", "noopener");
  }

  return (
    <>
      <div className="card mb-3">
        <div className="card-header pb-0">
          <h6>الإنتاج</h6>
          <p className="text-sm mb-0">
            ارفع صور الفندق، ثم أنتج صورًا مُعلَّمة أو فيديو يتبع تسلسل هويتك — كل ذلك يُركَّب محليًا، بلا حصص ولا انتظار خدمة خارجية.
          </p>
        </div>
        <div className="card-body pt-2">
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="form-control form-control-sm mb-2"
            disabled={!canManage || uploading}
            onChange={(e) => {
              if (e.target.files?.length) void addPhotos(e.target.files);
              e.target.value = "";
            }}
          />
          {note && <p className="text-xs text-success mb-2">{note}</p>}
          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-sm bg-gradient-primary mb-0" disabled={busy || photoIds.length === 0} onClick={onRenderPhoto}>
              إنتاج صور مُعلَّمة ({photoIds.length})
            </button>
            <button className="btn btn-sm bg-gradient-success mb-0" disabled={busy || photoIds.length === 0} onClick={onRenderVideo}>
              إنتاج فيديو
            </button>
            {busy && <span className="text-xs text-secondary align-self-center">جارٍ التركيب…</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header pb-0"><h6>ما أُنتج لهذه القناة</h6></div>
        <div className="card-body pt-2">
          {renders.length === 0 ? (
            <p className="text-sm text-secondary mb-0">لا يوجد إنتاج بعد.</p>
          ) : (
            renders.map((r) => (
              <div key={r.id} className="d-flex justify-content-between align-items-center border-bottom py-2 gap-2">
                <div>
                  <span className="text-sm">{r.kind === "video" ? "فيديو" : "صور"}</span>
                  <span className="text-xxs text-secondary d-block">
                    {new Date(r.createdAt).toLocaleString("ar-SA")} · {(r.durationMs / 1000).toFixed(1)} ثانية تركيب
                  </span>
                  {r.error && <span className="text-xxs text-danger d-block">{r.error}</span>}
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className={`badge badge-sm ${r.status === "ready" ? "bg-gradient-success" : r.status === "failed" ? "bg-gradient-danger" : "bg-gradient-warning"}`}>
                    {r.status === "ready" ? "جاهز" : r.status === "failed" ? "فشل" : "قيد التركيب"}
                  </span>
                  {r.outputFileId && (
                    <button className="btn btn-link text-primary text-xs p-0 mb-0" onClick={() => void open(r.outputFileId!)}>
                      فتح
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="card">
      <div className="card-body py-4 text-center">
        <p className="text-sm text-secondary mb-0">{text}</p>
      </div>
    </div>
  );
}
