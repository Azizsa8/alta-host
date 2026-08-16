import { useState } from "react";
import { api, type SimulateResult } from "../api/client.js";

const EXAMPLES = [
  "أحتاج تنظيف الغرفة وتمديد الخروج ساعتين",
  "نظفوا الغرفة لو سمحتوا، كلمة سر الواي فاي ما تشتغل",
  "هذا وضع مو مقبول، المكيف خربان وما جانا أحد، بسرعة!!!",
  "ابي أمدد إقامتي وأطلب تنظيف للغرفة",
];

const SENTIMENT_LABELS: Record<string, string> = {
  positive: "إيجابي",
  neutral: "محايد",
  negative: "سلبي",
};

export function Simulator({ propertyId, onDispatched }: { propertyId: string; onDispatched: () => void }) {
  const [from, setFrom] = useState("9665xxxxxxxx");
  const [text, setText] = useState(EXAMPLES[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.simulate({ propertyId, from, text });
      setResult(res);
      onDispatched();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إرسال الطلب");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="row">
      <div className="col-lg-7 col-md-9 mb-4">
        <div className="card">
          <div className="card-header pb-0">
            <h6>محاكي الرسائل</h6>
            <p className="text-sm mb-0">
              يقوم مقام رسالة واتساب حقيقية — يشغّل خط الأنابيب كاملاً (فهم النية ← الوكلاء ← نظام الفندقة ←
              التذاكر) دون الحاجة لاعتماد واتساب بزنس.
            </p>
          </div>
          <div className="card-body">
            <div className="mb-3">
              <label className="form-label text-sm">رقم واتساب النزيل</label>
              <input className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label text-sm">نص الرسالة</label>
              <textarea className="form-control" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="d-flex flex-wrap gap-2 mb-3">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="btn btn-outline-secondary btn-sm mb-0" onClick={() => setText(ex)}>
                  {ex.length > 30 ? ex.slice(0, 30) + "…" : ex}
                </button>
              ))}
            </div>
            <button className="btn bg-gradient-dark mb-0" onClick={send} disabled={loading || !text.trim()}>
              {loading ? "جارٍ الإرسال…" : "إرسال كنزيل"}
            </button>
            {error && <p className="text-danger text-sm mt-2 mb-0">{error}</p>}
          </div>
        </div>
      </div>

      {result && (
        <div className="col-lg-7 col-md-9 mb-4">
          <div className="card">
            <div className="card-header pb-0">
              <h6>النوايا المستخرجة</h6>
            </div>
            <div className="card-body pt-2">
              {result.intentEnvelope.intents.length === 0 ? (
                <p className="text-sm text-secondary">لم يتم التعرف على أي نية — المحرك القائم على القواعد يغطي مجموعة النوايا التجريبية فقط.</p>
              ) : (
                <table className="table align-items-center mb-3">
                  <tbody>
                    {result.intentEnvelope.intents.map((i, idx) => (
                      <tr key={idx}>
                        <td className="mono">
                          <b>{i.type}</b>
                        </td>
                        <td className="text-sm text-secondary">درجة الثقة {i.confidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="d-flex gap-2 mb-3">
                <span className={`badge ${result.intentEnvelope.urgency === "urgent" ? "bg-gradient-danger" : "bg-gradient-secondary"}`}>
                  {SENTIMENT_LABELS[result.intentEnvelope.sentiment] ?? result.intentEnvelope.sentiment}
                </span>
                <span className={`badge ${result.intentEnvelope.urgency === "urgent" ? "bg-gradient-danger" : "bg-gradient-success"}`}>
                  {result.intentEnvelope.urgency === "urgent" ? "عاجل" : "عادي"}
                </span>
              </div>
              <h6 className="text-sm">نتيجة التوجيه</h6>
              <ul className="list-group">
                {result.outcomes.map((o, idx) => (
                  <li key={idx} className="list-group-item border-0 ps-0 text-sm">
                    {o.status === "sent" ? (
                      o.reply
                    ) : (
                      <>
                        <span className="badge bg-gradient-warning me-2">بانتظار المراجعة</span>
                        {o.intentType} — بانتظار قائمة المراجعة، لم يُرسل للنزيل بعد.
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
