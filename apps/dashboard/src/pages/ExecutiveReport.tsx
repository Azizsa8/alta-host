import { useEffect, useState } from "react";
import { api, type DailyReport } from "../api/client.js";

export function ExecutiveReport({ propertyId, refreshKey }: { propertyId: string; refreshKey: number }) {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .dailyReport(propertyId)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [propertyId, refreshKey]);

  return (
    <div>
      <h1>Executive Report</h1>
      <p className="sub">
        The Executive Manager's daily brief — recommendations, not just counts (PRD §6).
      </p>

      {loading || !report ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="num">{report.totalTickets}</div>
              <div className="label">Total tickets</div>
            </div>
            <div className="metric-card">
              <div className="num">{report.urgentCount}</div>
              <div className="label">Urgent intents</div>
            </div>
            <div className="metric-card">
              <div className="num">{report.pendingReviews}</div>
              <div className="label">Pending review</div>
            </div>
            <div className="metric-card">
              <div className="num">{report.sentimentBreakdown.negative ?? 0}</div>
              <div className="label">Negative-sentiment messages</div>
            </div>
          </div>

          <div className="panel" style={{ maxWidth: 640, marginBottom: 24 }}>
            <h3 style={{ marginTop: 0, fontSize: "0.95rem" }}>Tickets by department</h3>
            {Object.keys(report.ticketsByDepartment).length === 0 ? (
              <p className="empty">No tickets yet</p>
            ) : (
              <table>
                <tbody>
                  {Object.entries(report.ticketsByDepartment).map(([dept, count]) => (
                    <tr key={dept}>
                      <td>
                        <b>{dept}</b>
                      </td>
                      <td className="mono">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel" style={{ maxWidth: 640 }}>
            <h3 style={{ marginTop: 0, fontSize: "0.95rem" }}>Recommendations</h3>
            {report.recommendations.length === 0 ? (
              <p className="empty">Nothing rises above threshold yet — no action needed.</p>
            ) : (
              <ul className="reply-list">
                {report.recommendations.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
