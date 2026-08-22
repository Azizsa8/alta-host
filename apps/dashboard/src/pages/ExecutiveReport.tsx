import { useEffect, useRef, useState } from "react";
import { Chart, type ChartConfiguration } from "chart.js/auto";
import { api, type DailyReport, type ReportKpis } from "../api/client.js";

const DEPARTMENT_LABELS: Record<string, string> = {
  reception: "الاستقبال",
  housekeeping: "التدبير المنزلي",
  maintenance: "الصيانة",
  guest_service: "خدمة النزلاء",
};

// FR-8/dataviz: a single measure (ticket count) compared across a small,
// already-labeled set of departments — the bars carry no separate identity
// to encode, so one sequential hue (blue, matching the template's own
// badge/info accent) is correct here; a categorical palette would only be
// needed if this chart mixed multiple series.
const BAR_COLOR = "#1A73E8";

function DepartmentChart({ data }: { data: Record<string, number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const labels = Object.keys(data).map((d) => DEPARTMENT_LABELS[d] ?? d);
    const values = Object.values(data);

    const config: ChartConfiguration = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "عدد التذاكر",
            data: values,
            backgroundColor: BAR_COLOR,
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    };

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, config);
    return () => chartRef.current?.destroy();
  }, [data]);

  return (
    <div style={{ height: 260 }}>
      <canvas ref={canvasRef} role="img" aria-label="عدد التذاكر حسب القسم" />
    </div>
  );
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} ثانية`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} دقيقة`;
  return `${(seconds / 3600).toFixed(1)} ساعة`;
}

/** The pilot's weekly KPIs (آخر ٧ أيام) — measured from real message
 *  timestamps and run outcomes, never self-reported. Null = «لا بيانات
 *  بعد», deliberately distinct from a bad zero. */
function KpiRow({ kpis }: { kpis: ReportKpis }) {
  const tiles: Array<{ label: string; value: string; sub: string; good?: boolean | null }> = [
    {
      label: "زمن أول رد (وسيط)",
      value: kpis.medianResponseSeconds !== null ? fmtDuration(kpis.medianResponseSeconds) : "—",
      sub: kpis.respondedCount > 0 ? `${kpis.respondedCount} رد خلال ${kpis.windowDays} أيام` : "لا بيانات بعد",
      good: kpis.medianResponseSeconds !== null ? kpis.medianResponseSeconds <= 60 : null,
    },
    {
      label: "نسبة الحل الآلي",
      value: kpis.autoResolutionPct !== null ? `${kpis.autoResolutionPct}٪` : "—",
      sub: kpis.totalRuns > 0 ? `من ${kpis.totalRuns} معالجة · ${kpis.takeovers} استلام بشري` : "لا بيانات بعد",
      good: kpis.autoResolutionPct !== null ? kpis.autoResolutionPct >= 50 : null,
    },
    {
      label: "رضا النزلاء",
      value:
        kpis.googleStarsAvg !== null
          ? `⭐ ${kpis.googleStarsAvg}`
          : kpis.positiveSentimentPct !== null
            ? `${kpis.positiveSentimentPct}٪ إيجابي`
            : "—",
      sub:
        kpis.googleStarsAvg !== null
          ? `${kpis.googleReviewCount} تقييم Google${kpis.positiveSentimentPct !== null ? ` · ${kpis.positiveSentimentPct}٪ رسائل إيجابية` : ""}`
          : "لا بيانات بعد",
      good: kpis.googleStarsAvg !== null ? kpis.googleStarsAvg >= 4 : null,
    },
    {
      label: "الالتزام بالمهل (SLA)",
      value: kpis.slaCompliancePct !== null ? `${kpis.slaCompliancePct}٪` : "—",
      sub: kpis.slaCompliancePct !== null ? "تذاكر أُنجزت ضمن مهلتها" : "لا تذاكر هذا الأسبوع",
      good: kpis.slaCompliancePct !== null ? kpis.slaCompliancePct >= 90 : null,
    },
  ];

  return (
    <div className="row mb-4">
      {tiles.map((t) => (
        <div className="col-md-6 col-xl-3 mb-3 mb-xl-0" key={t.label}>
          <div className="card h-100">
            <div className="card-body py-3">
              <p className="text-xs text-uppercase text-secondary font-weight-bolder mb-1">{t.label}</p>
              <h5 className="mb-0">
                {t.value}
                {t.good !== null && (
                  <span className={`badge badge-sm ms-2 ${t.good ? "bg-gradient-success" : "bg-gradient-warning"}`}>
                    {t.good ? "جيد" : "يحتاج انتباه"}
                  </span>
                )}
              </h5>
              <p className="text-xs text-secondary mb-0 mt-1">{t.sub}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

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

  if (loading || !report) {
    return <p className="text-sm text-secondary">جارٍ التحميل…</p>;
  }

  const hasDeptData = Object.keys(report.ticketsByDepartment).length > 0;

  return (
    <>
      <KpiRow kpis={report.kpis} />
      <p className="text-sm text-secondary mb-4">موجز المدير التنفيذي اليومي — توصيات، لا مجرد أرقام.</p>

      <div className="row">
        <div className="col-xl-3 col-lg-4 col-sm-6 mb-4">
          <div className="card">
            <div className="card-body p-3">
              <p className="text-sm mb-0">إجمالي التذاكر</p>
              <h4 className="mb-0">{report.totalTickets}</h4>
            </div>
          </div>
        </div>
        <div className="col-xl-3 col-lg-4 col-sm-6 mb-4">
          <div className="card">
            <div className="card-body p-3">
              <p className="text-sm mb-0">رسائل عاجلة</p>
              <h4 className="mb-0">{report.urgentCount}</h4>
            </div>
          </div>
        </div>
        <div className="col-xl-3 col-lg-4 col-sm-6 mb-4">
          <div className="card">
            <div className="card-body p-3">
              <p className="text-sm mb-0">بانتظار المراجعة</p>
              <h4 className="mb-0">{report.pendingReviews}</h4>
            </div>
          </div>
        </div>
        <div className="col-xl-3 col-lg-4 col-sm-6 mb-4">
          <div className="card">
            <div className="card-body p-3">
              <p className="text-sm mb-0">تجاوزت المهلة</p>
              <h4 className="mb-0 text-danger">{report.escalatedCount}</h4>
            </div>
          </div>
        </div>
        <div className="col-xl-3 col-lg-4 col-sm-6 mb-4">
          <div className="card">
            <div className="card-body p-3">
              <p className="text-sm mb-0">رسائل سلبية</p>
              <h4 className="mb-0">{report.sentimentBreakdown.negative ?? 0}</h4>
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-lg-7 mb-4">
          <div className="card h-100">
            <div className="card-header pb-0">
              <h6>التذاكر حسب القسم</h6>
            </div>
            <div className="card-body">
              {hasDeptData ? <DepartmentChart data={report.ticketsByDepartment} /> : <p className="text-sm text-secondary mb-0">لا توجد تذاكر بعد</p>}
            </div>
          </div>
        </div>

        <div className="col-lg-5 mb-4">
          <div className="card h-100">
            <div className="card-header pb-0">
              <h6>التوصيات</h6>
            </div>
            <div className="card-body pt-2">
              {report.recommendations.length === 0 ? (
                <p className="text-sm text-secondary mb-0">لا يوجد شيء يتجاوز الحد الآن — لا حاجة لإجراء.</p>
              ) : (
                <ul className="list-group">
                  {report.recommendations.map((r, idx) => (
                    <li key={idx} className="list-group-item border-0 ps-0 text-sm">
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
