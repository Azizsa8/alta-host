import { useEffect, useState } from "react";
import { api, eventStream, getToken, onUnauthorized, type Metrics, type Staff } from "./api/client.js";
import { Login } from "./pages/Login.js";
import { OpsCenter } from "./pages/OpsCenter.js";
import { Simulator } from "./pages/Simulator.js";
import { TicketBoard } from "./pages/TicketBoard.js";
import { Guests } from "./pages/Guests.js";
import { ReviewQueue } from "./pages/ReviewQueue.js";
import { ExecutiveReport } from "./pages/ExecutiveReport.js";
import { AuditTrail } from "./pages/AuditTrail.js";
import { Inbox } from "./pages/Inbox.js";
import { Storage } from "./pages/Storage.js";
import { WorkOrders } from "./pages/WorkOrders.js";
import { AgentCentre } from "./pages/AgentCentre.js";
import { Reputation } from "./pages/Reputation.js";
import { ContentStudio } from "./pages/ContentStudio.js";
import { PlatformAdmin } from "./pages/PlatformAdmin.js";
import { SocialChannels } from "./pages/SocialChannels.js";
import { Complaints } from "./pages/Complaints.js";

type View = "ops" | "inbox" | "simulator" | "reviews" | "tickets" | "workorders" | "guests" | "storage" | "agents" | "reputation" | "content" | "social" | "complaints" | "report" | "audit" | "platform";

// §3: alta_admin sees the platform console + audit only — never a
// hotel's guest data. Everyone else gets the hotel screens.
const PLATFORM_NAV: Array<{ key: View; label: string; icon: string }> = [
  { key: "platform", label: "إدارة المنصة", icon: "apartment" },
  { key: "audit", label: "سجل التدقيق", icon: "verified_user" },
];

/** Nav grouped by what a shift actually does: watch, then act on guests,
 *  then run the property, then grow it, then govern it. A flat list of
 *  fourteen identical rows costs a scan every single time. */
const NAV_GROUPS: Array<{ label: string; keys: View[] }> = [
  { label: "المراقبة", keys: ["ops"] },
  { label: "النزلاء", keys: ["inbox", "reviews", "guests", "simulator"] },
  { label: "التشغيل", keys: ["tickets", "workorders", "storage"] },
  { label: "النمو", keys: ["social", "content", "reputation", "complaints"] },
  { label: "الإدارة", keys: ["agents", "report", "audit"] },
];

const NAV_ITEMS: Array<{ key: View; label: string; icon: string }> = [
  { key: "ops", label: "مركز العمليات", icon: "hub" },
  { key: "inbox", label: "صندوق الرسائل", icon: "forum" },
  { key: "simulator", label: "المحاكي", icon: "chat" },
  { key: "reviews", label: "قائمة المراجعة", icon: "fact_check" },
  { key: "tickets", label: "لوحة التذاكر", icon: "confirmation_number" },
  { key: "workorders", label: "أوامر العمل", icon: "build" },
  { key: "agents", label: "مركز الوكلاء", icon: "smart_toy" },
  { key: "reputation", label: "السمعة الرقمية", icon: "star" },
  { key: "content", label: "استوديو المحتوى", icon: "campaign" },
  { key: "social", label: "قنوات التواصل", icon: "share" },
  { key: "complaints", label: "الشكاوى والسمعة", icon: "gavel" },
  { key: "guests", label: "النزلاء", icon: "groups" },
  { key: "storage", label: "الملفات والتخزين", icon: "folder" },
  { key: "report", label: "التقرير التنفيذي", icon: "summarize" },
  { key: "audit", label: "سجل التدقيق", icon: "verified_user" },
];

const VIEW_TITLES: Record<View, string> = {
  ops: "مركز العمليات",
  inbox: "صندوق الرسائل",
  simulator: "المحاكي",
  reviews: "قائمة المراجعة",
  tickets: "لوحة التذاكر",
  workorders: "أوامر العمل",
  agents: "مركز الوكلاء",
  reputation: "السمعة الرقمية",
  content: "استوديو المحتوى",
  social: "قنوات التواصل",
  complaints: "الشكاوى والسمعة",
  guests: "النزلاء",
  storage: "الملفات والتخزين",
  report: "التقرير التنفيذي",
  audit: "سجل التدقيق",
  platform: "إدارة المنصة",
};

const ROLE_LABELS: Record<string, string> = {
  reception: "الاستقبال",
  housekeeping: "التدبير المنزلي",
  maintenance: "الصيانة",
  maintenance_manager: "مدير الصيانة",
  guest_service: "خدمة النزلاء",
  manager: "الإدارة",
  hotel_manager: "مدير الفندق",
  general_manager: "المدير العام",
  technician: "فني",
  marketing_manager: "مدير التسويق",
  alta_admin: "إدارة المنصة",
};

export default function App() {
  const [staff, setStaff] = useState<Staff | null | undefined>(undefined); // undefined = still checking
  const [view, setView] = useState<View>("ops");

  // The platform operator lands on their console, not a hotel's ops centre.
  useEffect(() => {
    if (staff && staff.role === "alta_admin" && view === "ops") setView("platform");
  }, [staff, view]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidenavPinned, setSidenavPinned] = useState(false);

  // On load, a stored token is only a claim — confirm it against /auth/me
  // before trusting it, since it may have expired since the last visit.
  useEffect(() => {
    if (!getToken()) {
      setStaff(null);
      return;
    }
    api
      .me()
      .then(setStaff)
      .catch(() => setStaff(null));
  }, []);

  useEffect(() => {
    onUnauthorized(() => setStaff(null));
  }, []);

  useEffect(() => {
    if (!staff) return;
    api.metrics(staff.propertyId).then(setMetrics).catch(() => {});
  }, [staff, refreshKey]);

  // Live event feed: any pipeline event refreshes the visible view — SSE
  // replaced the old 4s polling entirely. EventSource auto-reconnects and
  // the server replays missed events via Last-Event-ID.
  useEffect(() => {
    if (!staff) return;
    return eventStream(() => setRefreshKey((k) => k + 1));
  }, [staff]);

  // Mirrors the template's own g-sidenav-pinned mechanism (see
  // _navbar-vertical.scss) for the mobile off-canvas sidenav — the
  // template's material-dashboard.min.js isn't loaded, so this toggle is
  // reimplemented directly against the same class the shipped CSS expects.
  useEffect(() => {
    document.body.classList.toggle("g-sidenav-pinned", sidenavPinned);
  }, [sidenavPinned]);

  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  function go(next: View) {
    setView(next);
    setSidenavPinned(false);
  }

  function logout() {
    api.logout();
    setStaff(null);
  }

  if (staff === undefined) {
    return null; // brief flash while /auth/me resolves — nothing to show yet
  }
  if (!staff) {
    return <Login onLoggedIn={setStaff} />;
  }

  return (
    <>
      <aside
        className="sidenav navbar navbar-vertical navbar-expand-xs border-0 border-radius-xl my-3 fixed-start ms-3 bg-gradient-dark"
        id="sidenav-main"
      >
        <div className="sidenav-header">
          <a className="navbar-brand m-0" href="#" onClick={(e) => e.preventDefault()}>
            <span className="hs-wordmark">
              Host<span className="hs-wordmark-accent">Ops</span>
            </span>
          </a>
          <p className="hs-wordmark-sub">عمليات الضيافة · فندق الرياض بوليفارد</p>
        </div>
        <hr className="horizontal light mt-2 mb-2" />
        <div className="collapse navbar-collapse w-auto max-height-vh-100" id="sidenav-collapse-main">
          <ul className="navbar-nav">
            {(staff.role === "alta_admin"
              ? PLATFORM_NAV.map((item) => ({ item, groupLabel: "" }))
              : NAV_GROUPS.flatMap((g) =>
                  g.keys
                    .map((k) => NAV_ITEMS.find((n) => n.key === k))
                    .filter((n): n is (typeof NAV_ITEMS)[number] => !!n)
                    .map((item, i) => ({ item, groupLabel: i === 0 ? g.label : "" }))
                )
            ).map(({ item, groupLabel }) => (
              <li className="nav-item" key={item.key}>
                {groupLabel && <p className="nav-group-label mb-0">{groupLabel}</p>}
                <a
                  className={`nav-link text-white ${view === item.key ? "active bg-gradient-primary" : ""}`}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.key);
                  }}
                >
                  <div className="text-white text-center me-2 d-flex align-items-center justify-content-center">
                    <i className="material-icons opacity-10">{item.icon}</i>
                  </div>
                  <span className="nav-link-text ms-1">
                    {item.label}
                    {item.key === "reviews" && metrics && metrics.pendingReviews > 0 ? ` (${metrics.pendingReviews})` : ""}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="sidenav-footer position-absolute w-100 bottom-0">
          <div className="mx-3 mb-3 pt-2 border-top border-white border-opacity-10">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <p className="text-white text-sm mb-0">{staff.name}</p>
                <p className="text-white opacity-6 text-xs mb-0">{ROLE_LABELS[staff.role] ?? staff.role}</p>
              </div>
              <button
                className="btn btn-outline-light btn-sm mb-0"
                onClick={logout}
                style={{ fontSize: "0.7rem", padding: "4px 10px" }}
              >
                خروج
              </button>
            </div>
          </div>
        </div>
      </aside>
      <main className="main-content position-relative max-height-vh-100 h-100 border-radius-lg">
        <nav className="navbar navbar-main navbar-expand-lg px-0 mx-4 shadow-none border-radius-xl" id="navbarBlur">
          <div className="container-fluid py-1 px-3">
            <nav aria-label="breadcrumb">
              <ol className="breadcrumb bg-transparent mb-0 pb-0 pt-1 px-0">
                <li className="breadcrumb-item text-sm">
                  <span className="opacity-5 text-dark">HostOps</span>
                </li>
                <li className="breadcrumb-item text-sm text-dark active" aria-current="page">
                  {VIEW_TITLES[view]}
                </li>
              </ol>
              <h6 className="font-weight-bolder mb-0">{VIEW_TITLES[view]}</h6>
            </nav>
            {metrics && (
              <div className="hs-statusbar" role="status" aria-label="حالة التشغيل">
                <span className="hs-stat">
                  <b className="hs-metric">{metrics.openTickets}</b>
                  <em>تذاكر مفتوحة</em>
                </span>
                <span className={`hs-stat ${metrics.escalatedTickets > 0 ? "is-crit" : ""}`}>
                  <b className="hs-metric">{metrics.escalatedTickets}</b>
                  <em>تجاوزت المهلة</em>
                </span>
                <span className={`hs-stat ${metrics.pendingReviews > 0 ? "is-warn" : ""}`}>
                  <b className="hs-metric">{metrics.pendingReviews}</b>
                  <em>بانتظار قرارك</em>
                </span>
                <span className={`hs-stat ${metrics.urgentIntents > 0 ? "is-warn" : ""}`}>
                  <b className="hs-metric">{metrics.urgentIntents}</b>
                  <em>رسائل عاجلة</em>
                </span>
                <span className="hs-stat">
                  <b className="hs-metric">{metrics.guestCount}</b>
                  <em>النزلاء</em>
                </span>
              </div>
            )}
            <div className="collapse navbar-collapse mt-sm-0 mt-2 me-md-0 me-sm-4" id="navbar">
              <ul className="navbar-nav justify-content-end ms-auto">
                <li className="nav-item d-xl-none ps-3 d-flex align-items-center">
                  <a
                    href="#"
                    className="nav-link text-body p-0"
                    onClick={(e) => {
                      e.preventDefault();
                      setSidenavPinned((v) => !v);
                    }}
                  >
                    <div className="sidenav-toggler-inner">
                      <i className="sidenav-toggler-line"></i>
                      <i className="sidenav-toggler-line"></i>
                      <i className="sidenav-toggler-line"></i>
                    </div>
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </nav>
        <div className="container-fluid py-4">
          {view === "ops" && <OpsCenter propertyId={staff.propertyId} />}
          {view === "inbox" && <Inbox staff={staff} refreshKey={refreshKey} />}
          {view === "simulator" && <Simulator propertyId={staff.propertyId} onDispatched={bumpRefresh} />}
          {view === "reviews" && <ReviewQueue propertyId={staff.propertyId} refreshKey={refreshKey} onChanged={bumpRefresh} />}
          {view === "tickets" && <TicketBoard propertyId={staff.propertyId} refreshKey={refreshKey} onChanged={bumpRefresh} />}
          {view === "guests" && <Guests propertyId={staff.propertyId} refreshKey={refreshKey} />}
          {view === "storage" && <Storage refreshKey={refreshKey} />}
          {view === "workorders" && <WorkOrders staff={staff} refreshKey={refreshKey} />}
          {view === "agents" && <AgentCentre staff={staff} refreshKey={refreshKey} />}
          {view === "reputation" && <Reputation staff={staff} refreshKey={refreshKey} />}
          {view === "content" && <ContentStudio staff={staff} refreshKey={refreshKey} />}
          {view === "social" && <SocialChannels staff={staff} refreshKey={refreshKey} />}
          {view === "complaints" && <Complaints staff={staff} refreshKey={refreshKey} />}
          {view === "platform" && <PlatformAdmin refreshKey={refreshKey} />}
          {view === "report" && <ExecutiveReport propertyId={staff.propertyId} refreshKey={refreshKey} />}
          {view === "audit" && <AuditTrail refreshKey={refreshKey} />}
        </div>
      </main>
    </>
  );
}
