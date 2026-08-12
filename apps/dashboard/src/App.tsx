import { useEffect, useState } from "react";
import { api, type Metrics } from "./api/client.js";
import { Simulator } from "./pages/Simulator.js";
import { TicketBoard } from "./pages/TicketBoard.js";
import { Guests } from "./pages/Guests.js";
import { ReviewQueue } from "./pages/ReviewQueue.js";
import { ExecutiveReport } from "./pages/ExecutiveReport.js";

const PROPERTY_ID = "demo-property";
type View = "simulator" | "reviews" | "tickets" | "guests" | "report";

export default function App() {
  const [view, setView] = useState<View>("simulator");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.metrics(PROPERTY_ID).then(setMetrics).catch(() => {});
  }, [refreshKey]);

  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          ALTA <span>·</span> Command Center
          <small>Riyadh Boulevard Hotel (Pilot) — MVP</small>
        </div>
        <nav className="nav">
          <button className={view === "simulator" ? "active" : ""} onClick={() => setView("simulator")}>
            Message Simulator
          </button>
          <button className={view === "reviews" ? "active" : ""} onClick={() => setView("reviews")}>
            Review Queue{metrics && metrics.pendingReviews > 0 ? ` (${metrics.pendingReviews})` : ""}
          </button>
          <button className={view === "tickets" ? "active" : ""} onClick={() => setView("tickets")}>
            Ticket Board
          </button>
          <button className={view === "guests" ? "active" : ""} onClick={() => setView("guests")}>
            Guests
          </button>
          <button className={view === "report" ? "active" : ""} onClick={() => setView("report")}>
            Executive Report
          </button>
        </nav>
        {metrics && (
          <div className="metrics-mini">
            <div className="row">
              <span>Open tickets</span>
              <b>{metrics.openTickets}</b>
            </div>
            <div className="row">
              <span>Escalated</span>
              <b>{metrics.escalatedTickets}</b>
            </div>
            <div className="row">
              <span>Total tickets</span>
              <b>{metrics.totalTickets}</b>
            </div>
            <div className="row">
              <span>Urgent intents</span>
              <b>{metrics.urgentIntents}</b>
            </div>
            <div className="row">
              <span>Guests</span>
              <b>{metrics.guestCount}</b>
            </div>
          </div>
        )}
      </aside>
      <main className="content">
        {view === "simulator" && <Simulator propertyId={PROPERTY_ID} onDispatched={bumpRefresh} />}
        {view === "reviews" && <ReviewQueue propertyId={PROPERTY_ID} refreshKey={refreshKey} onChanged={bumpRefresh} />}
        {view === "tickets" && <TicketBoard propertyId={PROPERTY_ID} refreshKey={refreshKey} onChanged={bumpRefresh} />}
        {view === "guests" && <Guests propertyId={PROPERTY_ID} refreshKey={refreshKey} />}
        {view === "report" && <ExecutiveReport propertyId={PROPERTY_ID} refreshKey={refreshKey} />}
      </main>
    </div>
  );
}
