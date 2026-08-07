import { useState } from "react";
import { api, type SimulateResult } from "../api/client.js";

const EXAMPLES = [
  "I need a room cleaning and a two-hour late check-out",
  "clean my room please, the wifi password doesn't work",
  "this is unacceptable, the AC is broken and nobody has come, urgent!!!",
  "ابي أمدد إقامتي وأطلب تنظيف للغرفة",
];

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
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Message Simulator</h1>
      <p className="sub">
        Stands in for a real WhatsApp message — exercises the full pipeline (NLU → agents → PMS → tickets)
        without WhatsApp Business API credentials.
      </p>

      <div className="panel" style={{ maxWidth: 640, marginBottom: 24 }}>
        <div className="field">
          <label>Guest WhatsApp ID</label>
          <input value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>Message text</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="btn ghost" onClick={() => setText(ex)} type="button">
              {ex.length > 34 ? ex.slice(0, 34) + "…" : ex}
            </button>
          ))}
        </div>
        <button className="btn" onClick={send} disabled={loading || !text.trim()}>
          {loading ? "Sending…" : "Send as guest"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>

      {result && (
        <div className="panel" style={{ maxWidth: 640 }}>
          <h3 style={{ marginTop: 0, fontSize: "0.95rem" }}>Extracted intents</h3>
          <table style={{ marginBottom: 16 }}>
            <tbody>
              {result.intentEnvelope.intents.length === 0 && (
                <tr>
                  <td colSpan={2} className="empty">
                    No intent matched — rule-based engine only recognizes the demo intent set.
                  </td>
                </tr>
              )}
              {result.intentEnvelope.intents.map((i, idx) => (
                <tr key={idx}>
                  <td className="mono">
                    <b>{i.type}</b>
                  </td>
                  <td>confidence {i.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <span className={`chip ${result.intentEnvelope.urgency === "urgent" ? "urgent" : "in_progress"}`}>
              {result.intentEnvelope.sentiment}
            </span>
            <span className={`chip ${result.intentEnvelope.urgency === "urgent" ? "urgent" : "done"}`}>
              {result.intentEnvelope.urgency}
            </span>
          </div>
          <h3 style={{ fontSize: "0.95rem" }}>Dispatch outcome</h3>
          <ul className="reply-list">
            {result.outcomes.map((o, idx) => (
              <li key={idx}>
                {o.status === "sent" ? (
                  o.reply
                ) : (
                  <>
                    <span className="chip open" style={{ marginRight: 8 }}>
                      queued for review
                    </span>
                    {o.intentType} — waiting in the Review Queue, not sent to the guest yet.
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
