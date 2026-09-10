import { useCallback, useEffect, useState } from "react";
import {
  api,
  type ConnectStart,
  type SocialAnalytics,
  type SocialCalendar,
  type SocialChannelRow,
  type Staff,
} from "../api/client.js";
import { ChannelLogo } from "../components/ChannelLogo.js";

const FAMILY_LABELS: Record<string, string> = {
  social: "شبكات",
  video: "فيديو",
  review: "تقييمات",
  messaging: "مراسلة",
  professional: "مهني",
  listing: "أدلة",
};
const PUBLISH_LABELS: Record<string, { label: string; cls: string; hint: string }> = {
  api: { label: "نشر مباشر", cls: "bg-gradient-success", hint: "ننشر مباشرة بعد ربط الحساب" },
  draft: { label: "مسودة", cls: "bg-gradient-warning", hint: "نجهّز وننشر يدويًا — لا واجهة نشر متاحة" },
  reply: { label: "ردود", cls: "bg-gradient-info", hint: "قناة رد على التقييمات لا قناة نشر" },
};
const MANAGE_ROLES = ["manager", "hotel_manager", "general_manager", "marketing_manager"];

/** §4 مركز الوكلاء → مدير التواصل الاجتماعي: every channel with its own
 *  settings, calendar slot plan, generation station and analytics. */
export function SocialChannels({ staff, refreshKey }: { staff: Staff; refreshKey: number }) {
  const canManage = MANAGE_ROLES.includes(staff.role);
  const [tab, setTab] = useState<"channels" | "calendar" | "analytics">("channels");
  const [channels, setChannels] = useState<SocialChannelRow[]>([]);
  const [calendar, setCalendar] = useState<SocialCalendar | null>(null);
  const [analytics, setAnalytics] = useState<SocialAnalytics | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Array<{ idea: string; body: string; fits: boolean }>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState<{ channel: SocialChannelRow; start: ConnectStart } | null>(null);

  const reload = useCallback(() => {
    api.socialChannels().then(setChannels).catch((e) => setError(String(e)));
    api.socialCalendar(14).then(setCalendar).catch(() => {});
    api.socialAnalytics().then(setAnalytics).catch(() => {});
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

  const enabled = channels.filter((c) => c.enabled);

  return (
    <div className="row">
      {connecting && (
        <ConnectDialog
          channel={connecting.channel}
          start={connecting.start}
          busy={busy}
          onClose={() => setConnecting(null)}
          onSave={(token, account) =>
            act(async () => {
              await api.saveChannelCredentials(connecting.channel.key, { token, account });
              setConnecting(null);
            })
          }
          onDemoConnect={(account) =>
            act(async () => {
              await api.demoConnectChannel(connecting.channel.key, account);
              setConnecting(null);
            })
          }
        />
      )}
      <div className="col-12 mb-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
        <ul className="nav nav-pills">
          {(
            [
              ["channels", `القنوات (${enabled.length}/${channels.length})`],
              ["calendar", "التقويم"],
              ["analytics", "التحليلات"],
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

      {tab === "channels" && (
        <div className="col-12">
          {Object.keys(FAMILY_LABELS).map((family) => {
            const group = channels.filter((c) => c.family === family);
            if (group.length === 0) return null;
            return (
              <div key={family} className="mb-3">
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-2">{FAMILY_LABELS[family]}</p>
                <div className="row">
                  {group.map((c) => (
                    <div className="col-md-6 col-xl-4 mb-2" key={c.key}>
                      <div className={`card h-100 ${c.enabled ? "" : "opacity-7"}`}>
                        <div className="card-body py-3">
                          <div className="d-flex justify-content-between align-items-start gap-2">
                            <div className="d-flex align-items-start gap-2">
                              <ChannelLogo channel={c.key} />
                              <div>
                                <h6 className="mb-0">{c.nameAr}</h6>
                                <p className="text-xs text-secondary mb-0">
                                  {c.accountRef || c.handle || c.name} · حد {c.maxChars} حرف
                                </p>
                              </div>
                            </div>
                            <span className={`badge badge-sm ${PUBLISH_LABELS[c.publish].cls}`} title={PUBLISH_LABELS[c.publish].hint}>
                              {PUBLISH_LABELS[c.publish].label}
                            </span>
                          </div>

                          <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
                            {c.connected ? (
                              <>
                                {c.demoConnection ? (
                                  <span
                                    className="badge badge-sm bg-gradient-warning"
                                    title="ربط عرض تجريبي — لم تُتبادل بيانات اعتماد حقيقية مع المنصة"
                                  >
                                    ● موصولة (عرض تجريبي)
                                  </span>
                                ) : (
                                  <span className="badge badge-sm bg-gradient-success">● موصولة</span>
                                )}
                                {canManage && (
                                  <button
                                    className="btn btn-link text-danger text-xs p-0 mb-0"
                                    disabled={busy}
                                    onClick={() => {
                                      if (window.confirm(`فصل ${c.nameAr}؟ سيفقد الوكيل صلاحية التنفيذ عليها.`))
                                        void act(() => api.disconnectChannel(c.key));
                                    }}
                                  >
                                    فصل
                                  </button>
                                )}
                              </>
                            ) : canManage ? (
                              <button
                                className="btn btn-sm bg-gradient-primary mb-0 py-1 px-3 text-xs"
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    const start = await api.connectChannel(c.key);
                                    setConnecting({ channel: c, start });
                                  })
                                }
                              >
                                ربط الحساب
                              </button>
                            ) : (
                              <span className="badge badge-sm bg-gradient-secondary">غير موصولة</span>
                            )}
                            {c.connectionError && <span className="text-xxs text-danger">{c.connectionError}</span>}
                          </div>

                          {/* What the agent may actually DO here, right now. */}
                          <p className="text-xxs text-secondary mb-0 mt-2">
                            {c.agent.canPublish
                              ? "الوكيل ينشر مباشرة على هذه القناة"
                              : c.agent.canReply
                                ? "الوكيل يرد على التقييمات هنا"
                                : c.agent.blockedReasonAr}
                          </p>

                          {canManage && (
                            <div className="form-check form-switch mt-2 mb-1">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                role="switch"
                                checked={c.enabled}
                                disabled={busy}
                                onChange={() => void act(() => api.updateSocialChannel(c.key, { enabled: !c.enabled }))}
                              />
                              <label className="form-check-label text-xs">{c.enabled ? "مفعّلة" : "متوقفة"}</label>
                            </div>
                          )}

                          {c.enabled && (
                            <>
                              <p className="text-xs text-secondary mb-1">
                                {c.postsPerWeek} منشور/أسبوع
                                {c.bestTimes.length > 0 ? ` · ${c.bestTimes.join("، ")}` : ""}
                              </p>
                              <button
                                className="btn btn-link text-primary text-xs p-0 mb-0"
                                onClick={() => setOpenKey(openKey === c.key ? null : c.key)}
                              >
                                {openKey === c.key ? "إخفاء الإعدادات" : "الإعدادات ومحطة التوليد"}
                              </button>
                            </>
                          )}

                          {openKey === c.key && (
                            <ChannelPanel
                              channel={c}
                              canManage={canManage}
                              busy={busy}
                              drafts={drafts[c.key] ?? []}
                              onSave={(patch) => act(() => api.updateSocialChannel(c.key, patch))}
                              onGenerate={() =>
                                act(async () => {
                                  const r = await api.generateForChannel(c.key, 3);
                                  setDrafts((d) => ({ ...d, [c.key]: r.drafts }));
                                })
                              }
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "calendar" && calendar && (
        <div className="col-12">
          <div className="card mb-3">
            <div className="card-header pb-0">
              <h6>خطة {calendar.windowDays} يومًا</h6>
              <p className="text-sm mb-0">
                {calendar.totalGap > 0 ? `${calendar.totalGap} فراغ نشر لم يُملأ بعد` : "الخطة مكتملة"}
              </p>
            </div>
            <div className="card-body px-0 pb-2">
              <div className="table-responsive">
                <table className="table align-items-center mb-0">
                  <thead>
                    <tr>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">القناة</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">المستهدف</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">مجدول</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">الفراغ</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">أفضل الأوقات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendar.plan.map((p) => (
                      <tr key={p.channel}>
                        <td className="ps-4 text-sm font-weight-bold">{p.nameAr}</td>
                        <td className="text-sm">{p.target}</td>
                        <td className="text-sm">{p.planned}</td>
                        <td>
                          <span className={`badge badge-sm ${p.gap > 0 ? "bg-gradient-warning" : "bg-gradient-success"}`}>
                            {p.gap > 0 ? p.gap : "مكتمل"}
                          </span>
                        </td>
                        <td className="text-sm">{p.bestTimes.join("، ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          {calendar.scheduled.length > 0 && (
            <div className="card">
              <div className="card-header pb-0"><h6>المجدول القادم</h6></div>
              <div className="card-body pt-2">
                {calendar.scheduled.map((s) => (
                  <div key={s.id} className="d-flex justify-content-between border-bottom py-2">
                    <span className="text-sm">{s.idea}</span>
                    <span className="text-xs text-secondary">
                      {s.channel} · {s.scheduledAt ? new Date(s.scheduledAt).toLocaleString("ar-SA") : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "analytics" && analytics && (
        <div className="col-12">
          <div className="row mb-3">
            <div className="col-md-4 mb-2">
              <div className="card"><div className="card-body py-3">
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">قنوات مفعّلة</p>
                <h5 className="mb-0">{analytics.channelsEnabled} <span className="text-sm text-secondary">من {analytics.channelsAvailable}</span></h5>
              </div></div>
            </div>
            <div className="col-md-4 mb-2">
              <div className="card"><div className="card-body py-3">
                <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">نُشر خلال ٣٠ يومًا</p>
                <h5 className="mb-0">{analytics.totalPublished30d}</h5>
              </div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-header pb-0">
              <h6>لكل قناة</h6>
              <p className="text-sm mb-0">الأرقام من آخر مزامنة مع المنصة — تظهر بتاريخها ولا تُقدَّر.</p>
            </div>
            <div className="card-body px-0 pb-2">
              <div className="table-responsive">
                <table className="table align-items-center mb-0">
                  <thead>
                    <tr>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">القناة</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">متابعون</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">وصول ٣٠ي</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">تفاعل</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">نُشر</th>
                      <th className="text-uppercase text-secondary text-xxs font-weight-bolder opacity-7">آخر مزامنة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.perChannel.map((c) => (
                      <tr key={c.channel}>
                        <td className="ps-4 text-sm font-weight-bold">{c.nameAr}</td>
                        <td className="text-sm">{c.followers.toLocaleString("ar-SA")}</td>
                        <td className="text-sm">{c.reach30d.toLocaleString("ar-SA")}</td>
                        <td className="text-sm">{c.engagementRate !== null ? `${c.engagementRate}٪` : "—"}</td>
                        <td className="text-sm">
                          {c.published30d}
                          {c.failed30d > 0 && <span className="text-danger text-xs"> · {c.failed30d} فشل</span>}
                        </td>
                        <td className="text-xs text-secondary">
                          {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleDateString("ar-SA") : "لم تُزامن بعد"}
                        </td>
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

function ChannelPanel({
  channel,
  canManage,
  busy,
  drafts,
  onSave,
  onGenerate,
}: {
  channel: SocialChannelRow;
  canManage: boolean;
  busy: boolean;
  drafts: Array<{ idea: string; body: string; fits: boolean }>;
  onSave: (p: Record<string, unknown>) => void;
  onGenerate: () => void;
}) {
  const [handle, setHandle] = useState(channel.handle);
  const [perWeek, setPerWeek] = useState(channel.postsPerWeek);
  const [times, setTimes] = useState(channel.bestTimes.join("، "));
  const [tone, setTone] = useState(channel.tone);

  return (
    <div className="border-top mt-2 pt-2">
      <p className="text-xxs text-secondary mb-2">{channel.toneHintAr}</p>
      {canManage && (
        <>
          <div className="d-flex gap-1 flex-wrap mb-2">
            <input className="form-control form-control-sm" style={{ maxWidth: 120 }} placeholder="@الحساب" value={handle} onChange={(e) => setHandle(e.target.value)} dir="ltr" />
            <input type="number" className="form-control form-control-sm" style={{ width: 70 }} value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))} />
            <input className="form-control form-control-sm" style={{ maxWidth: 130 }} placeholder="19:00، 21:30" value={times} onChange={(e) => setTimes(e.target.value)} dir="ltr" />
          </div>
          <input className="form-control form-control-sm mb-2" placeholder="نبرة هذه القناة" value={tone} onChange={(e) => setTone(e.target.value)} />
          <div className="form-check form-switch mb-2">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              checked={channel.autoPublish}
              disabled={busy || channel.publish !== "api"}
              onChange={() => onSave({ autoPublish: !channel.autoPublish })}
            />
            <label className="form-check-label text-xxs">
              نشر تلقائي {channel.publish !== "api" && "(غير متاح لهذه القناة)"}
            </label>
          </div>
          <div className="d-flex gap-1">
            <button
              className="btn btn-sm bg-gradient-primary mb-0 py-1 px-2 text-xs"
              disabled={busy}
              onClick={() =>
                onSave({
                  handle,
                  postsPerWeek: perWeek,
                  bestTimes: times.split(/[,،]/).map((t) => t.trim()).filter(Boolean),
                  tone,
                })
              }
            >
              حفظ
            </button>
            <button className="btn btn-sm btn-outline-primary mb-0 py-1 px-2 text-xs" disabled={busy} onClick={onGenerate}>
              💡 توليد لهذه القناة
            </button>
          </div>
        </>
      )}
      {drafts.length > 0 && (
        <div className="mt-2">
          {drafts.map((d, i) => (
            <div key={i} className="border rounded-2 p-2 mb-1">
              <p className="text-xs mb-1" style={{ whiteSpace: "pre-line" }}>{d.body}</p>
              <span className={`badge badge-sm ${d.fits ? "bg-gradient-success" : "bg-gradient-danger"}`}>
                {d.fits ? `${d.body.length}/${channel.maxChars}` : `يتجاوز الحد (${d.body.length}/${channel.maxChars})`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The connect dialog. What it shows depends on how the channel can
 *  ACTUALLY be connected — a redirect when a developer app is registered,
 *  a credential form when it is not, and an honest explanation when the
 *  platform has no automated surface at all. */
/** The demo sign-in: the same three beats a real platform login has — who
 *  you are signing in as, what the hotel is granting, then confirm — so the
 *  walkthrough shows the actual journey. Labelled a demo throughout, because
 *  a connection screen that hides which kind it is, is the one thing here
 *  that would genuinely mislead. */
function DemoSignIn({
  channel,
  demo,
  busy,
  onConnect,
}: {
  channel: SocialChannelRow;
  demo: NonNullable<Extract<ConnectStart, { mode: "token" }>["demo"]>;
  busy: boolean;
  onConnect: (account: string) => void;
}) {
  const [account, setAccount] = useState(demo.suggestedAccount);
  const [step, setStep] = useState<"signin" | "grant">("signin");

  const grants = [
    `النشر باسم ${account || demo.suggestedAccount}`,
    "قراءة التفاعل والمتابعين للتحليلات",
    "قراءة التعليقات والرسائل الواردة والرد عليها",
  ];

  return (
    <div className="border border-1 rounded-3 p-3" style={{ borderColor: "var(--hs-line-soft)" }}>
      <div className="d-flex align-items-center gap-2 mb-3">
        <ChannelLogo channel={channel.key} size={28} />
        <div className="flex-grow-1">
          <p className="text-sm font-weight-bold mb-0">تسجيل الدخول إلى {demo.platformAr}</p>
          <p className="text-xxs text-secondary mb-0">{step === "signin" ? "الخطوة ١ من ٢" : "الخطوة ٢ من ٢"}</p>
        </div>
        <span className="badge badge-sm bg-gradient-warning">عرض تجريبي</span>
      </div>

      {step === "signin" ? (
        <>
          <label className="text-xs">الحساب أو الصفحة</label>
          <input
            className="form-control form-control-sm mb-2"
            dir="ltr"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={demo.suggestedAccount}
          />
          <button
            className="btn bg-gradient-primary w-100 mb-0"
            disabled={busy || account.trim().length < 2}
            onClick={() => setStep("grant")}
          >
            متابعة
          </button>
        </>
      ) : (
        <>
          <p className="text-xs mb-2">
            سيمنح <span className="font-weight-bold">{account}</span> منصة HostOps الصلاحيات التالية:
          </p>
          <ul className="text-xs ps-3 mb-3">
            {grants.map((g) => (
              <li key={g} className="mb-1">
                {g}
              </li>
            ))}
          </ul>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary btn-sm mb-0" disabled={busy} onClick={() => setStep("signin")}>
              رجوع
            </button>
            <button
              className="btn bg-gradient-primary flex-grow-1 mb-0"
              disabled={busy}
              onClick={() => onConnect(account.trim())}
            >
              الموافقة والربط
            </button>
          </div>
        </>
      )}
      <p className="text-xxs text-secondary mb-0 mt-2">{demo.noteAr}</p>
    </div>
  );
}

function ConnectDialog({
  channel,
  start,
  busy,
  onClose,
  onSave,
  onDemoConnect,
}: {
  channel: SocialChannelRow;
  start: ConnectStart;
  busy: boolean;
  onClose: () => void;
  onSave: (token: string, account: string) => void;
  onDemoConnect: (account: string) => void;
}) {
  const [token, setToken] = useState("");
  const [account, setAccount] = useState("");
  const demo = start.mode === "manual" ? undefined : start.demo;
  // With no developer app registered, the token box is the path nobody can
  // walk today — so the demo sign-in leads and the token box sits behind a
  // disclosure for whoever actually has a token.
  const [showToken, setShowToken] = useState(false);

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
      style={{ background: "rgba(0,0,0,.55)", zIndex: 1050 }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="card" style={{ maxWidth: 480, width: "92%" }} onClick={(e) => e.stopPropagation()}>
        <div className="card-header pb-0 d-flex align-items-center gap-2">
          <ChannelLogo channel={channel.key} size={36} />
          <div>
            <h6 className="mb-0">ربط {channel.nameAr}</h6>
            <p className="text-xs text-secondary mb-0">{channel.toneHintAr}</p>
          </div>
        </div>
        <div className="card-body pt-3">
          {start.mode === "oauth" && (
            <>
              <p className="text-sm">
                ستفتح صفحة {channel.nameAr} لتسجيل الدخول والموافقة على الصلاحيات. بعد الموافقة يعود الربط تلقائيًا
                ويصبح الوكيل قادرًا على التنفيذ.
              </p>
              <a className="btn bg-gradient-primary w-100 mb-2" href={start.authorizeUrl} target="_blank" rel="noopener">
                المتابعة إلى {channel.nameAr}
              </a>
              <p className="text-xxs text-secondary mb-0">
                لا نرى كلمة مرورك أبدًا — المنصة نفسها هي من تتحقق منك، ونستلم رمز وصول يُخزَّن مشفّرًا.
              </p>
            </>
          )}

          {demo && (
            <div className="mb-3">
              <DemoSignIn channel={channel} demo={demo} busy={busy} onConnect={onDemoConnect} />
            </div>
          )}

          {start.mode === "token" && demo && !showToken && (
            <button className="btn btn-link text-xs p-0 mb-0" onClick={() => setShowToken(true)}>
              لديك رمز وصول حقيقي من {channel.nameAr}؟ اربط به بدلًا من ذلك
            </button>
          )}

          {start.mode === "token" && (!demo || showToken) && (
            <>
              <div className="alert alert-info text-white text-xs py-2">{start.noteAr}</div>
              {start.fields.map((f) => (
                <div key={f.key} className="mb-2">
                  <label className="text-xs">{f.labelAr}</label>
                  <input
                    className="form-control form-control-sm"
                    type={f.secret ? "password" : "text"}
                    dir="ltr"
                    value={f.key === "token" ? token : account}
                    onChange={(e) => (f.key === "token" ? setToken(e.target.value) : setAccount(e.target.value))}
                  />
                  <p className="text-xxs text-secondary mb-0 mt-1">{f.hintAr}</p>
                </div>
              ))}
              <button
                className="btn bg-gradient-primary w-100 mb-2"
                disabled={busy || token.trim().length < 8}
                onClick={() => onSave(token.trim(), account.trim())}
              >
                التحقق والربط
              </button>
              <p className="text-xxs text-secondary mb-0">
                نتحقق من الرمز مع المنصة أولًا — الرمز المرفوض لا يُحفظ كقناة موصولة. يُخزَّن مشفّرًا (AES-256-GCM)
                ولا يُعرض بعد الحفظ أبدًا.
              </p>
            </>
          )}

          {start.mode === "manual" && (
            <>
              <p className="text-sm mb-2">{start.noteAr}</p>
              <p className="text-xs text-secondary mb-0">
                القناة تبقى في التقويم والتوليد: نجهّز المحتوى جاهزًا للنشر، لكن الخطوة الأخيرة يدوية — ولا ندّعي غير ذلك.
              </p>
            </>
          )}
        </div>
        <div className="card-footer pt-0">
          <button className="btn btn-outline-secondary btn-sm w-100 mb-0" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
