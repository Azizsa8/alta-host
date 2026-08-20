import { useEffect, useState } from "react";
import { api, eventStream, getToken, onUnauthorized, type Metrics, type Staff } from "./api/client.js";
import { Login } from "./pages/Login.js";
import { Simulator } from "./pages/Simulator.js";
import { TicketBoard } from "./pages/TicketBoard.js";
import { Guests } from "./pages/Guests.js";
import { ReviewQueue } from "./pages/ReviewQueue.js";
import { ExecutiveReport } from "./pages/ExecutiveReport.js";

type View = "simulator" | "reviews" | "tickets" | "guests" | "report";

const NAV_ITEMS: Array<{ key: View; label: string; icon: string }> = [
  { key: "simulator", label: "المحاكي", icon: "chat" },
  { key: "reviews", label: "قائمة المراجعة", icon: "fact_check" },
  { key: "tickets", label: "لوحة التذاكر", icon: "confirmation_number" },
  { key: "guests", label: "النزلاء", icon: "groups" },
  { key: "report", label: "التقرير التنفيذي", icon: "summarize" },
];

const VIEW_TITLES: Record<View, string> = {
  simulator: "المحاكي",
  reviews: "قائمة المراجعة",
  tickets: "لوحة التذاكر",
  guests: "النزلاء",
  report: "التقرير التنفيذي",
};

const ROLE_LABELS: Record<string, string> = {
  reception: "الاستقبال",
  housekeeping: "التدبير المنزلي",
  maintenance: "الصيانة",
  guest_service: "خدمة النزلاء",
  manager: "الإدارة",
};

export default function App() {
  const [staff, setStaff] = useState<Staff | null | undefined>(undefined); // undefined = still checking
  const [view, setView] = useState<View>("simulator");
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
            <span className="ms-1 font-weight-bold text-white fs-5">ألتا</span>
          </a>
          <p className="text-white opacity-8 text-xs mb-0 mt-1">فندق الرياض بوليفارد (تجريبي)</p>
        </div>
        <hr className="horizontal light mt-2 mb-2" />
        <div className="collapse navbar-collapse w-auto max-height-vh-100" id="sidenav-collapse-main">
          <ul className="navbar-nav">
            {NAV_ITEMS.map((item) => (
              <li className="nav-item" key={item.key}>
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
          {metrics && (
            <div className="mx-3 mb-3 text-white text-xs opacity-8">
              <div className="d-flex justify-content-between py-1">
                <span>تذاكر مفتوحة</span>
                <b className="mono">{metrics.openTickets}</b>
              </div>
              <div className="d-flex justify-content-between py-1">
                <span>تجاوزت المهلة</span>
                <b className="mono">{metrics.escalatedTickets}</b>
              </div>
              <div className="d-flex justify-content-between py-1">
                <span>إجمالي التذاكر</span>
                <b className="mono">{metrics.totalTickets}</b>
              </div>
              <div className="d-flex justify-content-between py-1">
                <span>رسائل عاجلة</span>
                <b className="mono">{metrics.urgentIntents}</b>
              </div>
              <div className="d-flex justify-content-between py-1">
                <span>النزلاء</span>
                <b className="mono">{metrics.guestCount}</b>
              </div>
            </div>
          )}
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
                  <span className="opacity-5 text-dark">ألتا</span>
                </li>
                <li className="breadcrumb-item text-sm text-dark active" aria-current="page">
                  {VIEW_TITLES[view]}
                </li>
              </ol>
              <h6 className="font-weight-bolder mb-0">{VIEW_TITLES[view]}</h6>
            </nav>
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
          {view === "simulator" && <Simulator propertyId={staff.propertyId} onDispatched={bumpRefresh} />}
          {view === "reviews" && <ReviewQueue propertyId={staff.propertyId} refreshKey={refreshKey} onChanged={bumpRefresh} />}
          {view === "tickets" && <TicketBoard propertyId={staff.propertyId} refreshKey={refreshKey} onChanged={bumpRefresh} />}
          {view === "guests" && <Guests propertyId={staff.propertyId} refreshKey={refreshKey} />}
          {view === "report" && <ExecutiveReport propertyId={staff.propertyId} refreshKey={refreshKey} />}
        </div>
      </main>
    </>
  );
}
