import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, eventStream, type AgentDefinition, type LiveEvent } from "../api/client.js";

/* ===========================================================
   The live fleet view. Agent nodes come from the backend
   registry (/api/agents) so the picture can never drift from
   the configuration that actually routes traffic; the pulses
   come from the same SSE feed the rest of the dashboard uses.
   =========================================================== */

/** How long a node stays visually "hot" after its last event. */
const ACTIVE_MS = 2600;

type NodeState = "idle" | "active" | "waiting" | "done";

interface AgentNodeData extends Record<string, unknown> {
  label: string;
  sublabel: string;
  state: NodeState;
  count: number;
  reviewPolicy?: AgentDefinition["reviewPolicy"];
  kind: "guest" | "supervisor" | "agent" | "sub" | "sink";
}

const STATE_COLORS: Record<NodeState, { border: string; glow: string; chip: string }> = {
  idle: { border: "#2C2140", glow: "none", chip: "#6A5F7C" },
  active: { border: "#E4177E", glow: "0 0 0 5px rgba(228,23,126,.16)", chip: "#FF5BA3" },
  waiting: { border: "#C9A227", glow: "0 0 0 5px rgba(201,162,39,.18)", chip: "#E8A33D" },
  done: { border: "#3FBF8F", glow: "0 0 0 5px rgba(63,191,143,.14)", chip: "#3FBF8F" },
};

const STATE_LABEL_AR: Record<NodeState, string> = {
  idle: "خامل",
  active: "يعمل الآن",
  waiting: "بانتظار المراجعة",
  done: "اكتمل",
};

function AgentNode({ data }: NodeProps) {
  const d = data as AgentNodeData;
  const c = STATE_COLORS[d.state];
  return (
    <div
      style={{
        minWidth: d.kind === "sub" ? 150 : 190,
        opacity: d.kind === "sub" ? 0.95 : 1,
        background: d.kind === "sub" ? "#171221" : "#1F1830",
        border: `1px solid ${c.border}`,
        boxShadow: c.glow === "none" ? "none" : c.glow,
        borderRadius: 6,
        padding: "12px 14px",
        transition: "border-color .25s ease, box-shadow .25s ease",
        direction: "rtl",
        textAlign: "right",
      }}
    >
      <Handle type="target" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <span style={{ fontWeight: d.kind === "sub" ? 500 : 700, fontSize: d.kind === "sub" ? 12 : 13.5, color: "#F3EFF7" }}>
          {d.kind === "sub" ? "↳ " : ""}
          {d.label}
        </span>
        {d.count > 0 && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
              background: c.chip,
              borderRadius: 999,
              padding: "1px 7px",
              minWidth: 18,
              textAlign: "center",
            }}
          >
            {d.count}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: "#9A8FA8", marginTop: 3, fontFamily: "IBM Plex Mono, monospace" }}>{d.sublabel}</div>
      <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: c.chip }}>{STATE_LABEL_AR[d.state]}</span>
        {d.reviewPolicy === "human_review" && (
          <span style={{ fontSize: 10, color: "#E8A33D", background: "rgba(232,163,61,.14)", border: "1px solid rgba(232,163,61,.35)", borderRadius: 4, padding: "0 5px" }}>
            مراجعة بشرية
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Left} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

/** Human-readable Arabic line for the activity ticker. */
function describe(evt: LiveEvent): string {
  const p = evt.payload as Record<string, unknown>;
  switch (evt.type) {
    case "message.received":
      return `رسالة واردة: "${String(p.preview ?? "").slice(0, 60)}"`;
    case "intent.extracted": {
      const list = (p.intents as Array<{ type: string }> | undefined) ?? [];
      return `استخراج ${list.length} نية — ${list.map((i) => i.type).join("، ") || "لا شيء"}`;
    }
    case "agent.started":
      return `بدأ ${String(p.agentKey)} على ${String(p.intentType)}`;
    case "agent.completed":
      return `أنهى ${String(p.agentKey)} — ${p.outcome === "sent" ? "أُرسل" : "بانتظار المراجعة"}`;
    case "review.queued":
      return `طلب من ${String(p.department)} ينتظر موافقة بشرية`;
    case "review.decided":
      return `${p.decision === "approved" ? "وافق" : "رفض"} ${String(p.reviewedBy)} على الطلب`;
    case "subagent.started":
      return `↳ ${String(p.agentKey)} يفحص…`;
    case "subagent.completed":
      return p.outcome === "blocked"
        ? `↳ ${String(p.agentKey)} أوقف الطلب — ${String(p.detail ?? "")}`
        : `↳ ${String(p.agentKey)} تم — ${String(p.detail ?? "سليم")}`;
    case "ticket.created":
      return `تذكرة جديدة (${String(p.department)}): ${String(p.summary ?? "").slice(0, 50)}`;
    case "ticket.escalated":
      return `تصعيد تذكرة في ${String(p.department)} — تجاوزت المهلة`;
    case "conversation.takenover":
      return `👤 استلم ${String(p.byName ?? "موظف")} المحادثة — الذكاء متوقف`;
    case "conversation.resumed":
      return `↩ أُعيدت المحادثة للذكاء الاصطناعي`;
    case "storage.alert":
      return `⚠ التخزين وصل ${String(p.usedPct)}٪ من حصة ${String(p.quotaGb)}GB`;
    case "workorder.created":
      return `أمر عمل جديد: ${String(p.title ?? "").slice(0, 40)} (${String(p.location ?? "")})`;
    case "workorder.critical":
      return `🚨 عطل حرج: ${String(p.title ?? "").slice(0, 40)} — ${String(p.location ?? "")} — تصعيد فوري`;
    case "workorder.updated":
      return `تحديث أمر عمل → ${String(p.status)}`;
    case "workorder.closed":
      return `أُغلق أمر عمل (${p.priority === "critical" ? "حرج — بتأكيد المدير" : "عادي"})`;
    case "review.fetched":
      return `تقييم Google جديد: ${"★".repeat(Number(p.stars) || 0)} (${String(p.topic)})`;
    case "review.alert":
      return `🚨 تقييم يستدعي التدخل (${String(p.topic)}): ${String(p.preview ?? "").slice(0, 50)}`;
    case "review.replied":
      return `رد معتمد نُشر على تقييم ${"★".repeat(Number(p.stars) || 0)}`;
    case "content.status":
      return `محتوى ${String(p.channel)} → ${String(p.status)}`;
    case "content.published":
      return `📣 نُشر محتوى على ${String(p.channel)}`;
    case "content.failed":
      return `⚠ فشل نشر محتوى على ${String(p.channel)}`;
    case "complaint.captured":
      return `فُتحت حالة شكوى (${String(p.category)}) — خطورة ${String(p.severity)}`;
    case "complaint.reputation_risk":
      return `🚨 خطر سمعة ${String(p.reputationRisk)}٪: ${String(p.preview ?? "").slice(0, 50)}`;
    case "complaint.status":
      return `حالة الشكوى → ${String(p.status)}`;
    case "social.connected":
      return `🔗 رُبطت قناة ${String(p.channel)}`;
    case "social.stats":
      return `تحديث أرقام ${String(p.channel)} — ${String(p.followers)} متابع`;
    default:
      return evt.type;
  }
}

/** Which node an event should light up. */
function nodeForEvent(evt: LiveEvent): { id: string; state: NodeState } | null {
  const p = evt.payload as Record<string, unknown>;
  switch (evt.type) {
    case "message.received":
      return { id: "guest", state: "active" };
    case "intent.extracted":
      return { id: "concierge_supervisor", state: "active" };
    case "agent.started":
      return { id: String(p.agentKey), state: "active" };
    case "agent.completed":
      return { id: String(p.agentKey), state: "done" };
    case "review.queued":
      return { id: "review", state: "waiting" };
    case "review.decided":
      return { id: "review", state: "done" };
    case "subagent.started":
      return { id: String(p.agentKey), state: "active" };
    case "subagent.completed":
      // A blocked sub-agent is the reason its parent stopped — hold it
      // amber so the cause stays visible instead of flashing past.
      return { id: String(p.agentKey), state: p.outcome === "blocked" ? "waiting" : "done" };
    case "ticket.created":
    case "ticket.escalated":
      return { id: "tickets", state: evt.type === "ticket.escalated" ? "waiting" : "done" };
    default:
      return null;
  }
}

export function OpsCenter({ propertyId }: { propertyId: string }) {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [states, setStates] = useState<Record<string, NodeState>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<AgentDefinition | null>(null);
  const [live, setLive] = useState(true);
  const timers = useRef<Record<string, number>>({});

  // ---- incident replay ----------------------------------------------
  // The same events that drive the live view are persisted in order, so
  // replaying an incident is just walking that history back through the
  // identical pulse logic — no separate "demo mode" that could drift
  // from how the system actually behaves.
  const [history, setHistory] = useState<LiveEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);

  useEffect(() => {
    api.agents().then(setAgents).catch(() => {});
    api.recentEvents(60).then((evts) => setFeed(evts.reverse())).catch(() => {});
  }, [propertyId]);

  /** Light a node up, then let it fade back to idle on its own. */
  const pulse = useCallback((id: string, state: NodeState) => {
    setStates((prev) => ({ ...prev, [id]: state }));
    setCounts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    window.clearTimeout(timers.current[id]);
    // "waiting" persists — a pending human decision is a real standing
    // state, not a momentary flash like an agent finishing its work.
    if (state !== "waiting") {
      timers.current[id] = window.setTimeout(() => {
        setStates((prev) => ({ ...prev, [id]: "idle" }));
      }, ACTIVE_MS);
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    return eventStream((evt) => {
      setFeed((prev) => [evt, ...prev].slice(0, 120));
      const target = nodeForEvent(evt);
      if (target) pulse(target.id, target.state);
    });
  }, [live, pulse]);

  /** Clears every node back to idle — used when switching modes so a
   *  replay never starts on top of leftover live state. */
  const resetBoard = useCallback(() => {
    Object.values(timers.current).forEach((t) => window.clearTimeout(t));
    timers.current = {};
    setStates({});
    setCounts({});
  }, []);

  /** Enter replay: stop the live feed and load the recent history. */
  async function startReplay() {
    setLive(false);
    setPlaying(false);
    resetBoard();
    const evts = await api.recentEvents(200);
    setHistory(evts); // oldest → newest
    setCursor(0);
    setFeed([]);
  }

  function backToLive() {
    setPlaying(false);
    setHistory([]);
    resetBoard();
    setFeed([]);
    api.recentEvents(60).then((e) => setFeed(e.reverse())).catch(() => {});
    setLive(true);
  }

  /** Steps the replay forward, applying each event through the same
   *  pulse path the live feed uses. */
  useEffect(() => {
    if (!playing || history.length === 0) return;
    if (cursor >= history.length) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => {
      const evt = history[cursor];
      setFeed((prev) => [evt, ...prev].slice(0, 120));
      const target = nodeForEvent(evt);
      if (target) pulse(target.id, target.state);
      setCursor((c) => c + 1);
    }, 900 / speed);
    return () => window.clearTimeout(id);
  }, [playing, cursor, history, speed, pulse]);

  /** Scrubbing jumps the board to a point in the incident by replaying
   *  everything up to it instantly, so the picture is always the true
   *  cumulative state at that moment rather than a single frame. */
  function scrubTo(index: number) {
    setPlaying(false);
    resetBoard();
    const upto = history.slice(0, index);
    const st: Record<string, NodeState> = {};
    const ct: Record<string, number> = {};
    upto.forEach((evt) => {
      const t = nodeForEvent(evt);
      if (!t) return;
      st[t.id] = t.state;
      ct[t.id] = (ct[t.id] ?? 0) + 1;
    });
    setStates(st);
    setCounts(ct);
    setFeed(upto.slice().reverse().slice(0, 120));
    setCursor(index);
  }

  // Node identities and positions are built ONCE per agent roster. Live
  // state is pushed into node.data afterwards — rebuilding the array on
  // every event would hand React Flow brand-new nodes each time and its
  // mount-time fitView would no longer point at them (the canvas blanks).
  const baseNodes = useMemo<Node<AgentNodeData>[]>(() => {
    const specialists = agents.filter((a) => a.department !== "supervisor");
    const empty = { state: "idle" as NodeState, count: 0 };
    const built: Node<AgentNodeData>[] = [
      {
        id: "guest",
        type: "agent",
        position: { x: 640, y: 200 },
        data: { label: "النزيل", sublabel: "واتساب", kind: "guest", ...empty },
      },
      {
        id: "concierge_supervisor",
        type: "agent",
        position: { x: 380, y: 200 },
        data: {
          label: "المنسّق الرئيسي",
          sublabel: "استخراج النية والتوجيه",
          kind: "supervisor",
          ...empty,
        },
      },
    ];
    // Depth-1 specialists on their own column; each one's sub-agents sit
    // further left (RTL: further "downstream") and vertically beside their
    // parent, so the tree reads as a hierarchy rather than a flat fleet.
    const departments = specialists.filter((a) => a.depth === 1);
    let row = 0;
    departments.forEach((a) => {
      const children = specialists.filter((c) => c.parent === a.key);
      const parentY = 40 + row * 96;
      built.push({
        id: a.key,
        type: "agent",
        position: { x: 120, y: parentY },
        data: {
          label: a.nameAr,
          sublabel: a.handlesIntents.join("، "),
          reviewPolicy: a.reviewPolicy,
          kind: "agent",
          ...empty,
        },
      });
      children.forEach((c, ci) => {
        built.push({
          id: c.key,
          type: "agent",
          position: { x: -120, y: parentY + ci * 74 - (children.length - 1) * 20 },
          data: {
            label: c.nameAr,
            sublabel: c.tools.join("، "),
            kind: "sub",
            ...empty,
          },
        });
      });
      row += Math.max(1, children.length);
    });
    built.push(
      {
        id: "review",
        type: "agent",
        position: { x: -370, y: 90 },
        data: {
          label: "قائمة المراجعة",
          sublabel: "قرار بشري قبل الإرسال",
          kind: "sink",
          ...empty,
        },
      },
      {
        id: "tickets",
        type: "agent",
        position: { x: -370, y: 300 },
        data: {
          label: "التذاكر والتصعيد",
          sublabel: "مهلة استجابة لكل قسم",
          kind: "sink",
          ...empty,
        },
      }
    );
    return built;
  }, [agents]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AgentNodeData>>([]);

  // Rebuild only when the roster changes (adds/removes nodes).
  useEffect(() => {
    setNodes(baseNodes);
  }, [baseNodes, setNodes]);

  // Push live state into existing nodes without touching their identity
  // or position, so the viewport stays exactly where the user left it.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const state = states[n.id] ?? "idle";
        const count = counts[n.id] ?? 0;
        if (n.data.state === state && n.data.count === count) return n;
        return { ...n, data: { ...n.data, state, count } };
      })
    );
  }, [states, counts, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const isHot = (id: string) => (states[id] ?? "idle") !== "idle";
    const e: Edge[] = [
      {
        id: "guest-sup",
        source: "guest",
        target: "concierge_supervisor",
        animated: isHot("concierge_supervisor") || isHot("guest"),
        style: { stroke: isHot("concierge_supervisor") ? "#ec407a" : "#c9cfdd", strokeWidth: 2 },
      },
    ];
    agents
      .filter((a) => a.department !== "supervisor" && a.depth === 1)
      .forEach((a) => {
        e.push({
          id: `sup-${a.key}`,
          source: "concierge_supervisor",
          target: a.key,
          animated: isHot(a.key),
          style: { stroke: isHot(a.key) ? "#ec407a" : "#c9cfdd", strokeWidth: 2 },
        });
        // Parent → sub-agent, drawn thinner and dashed so the hierarchy
        // reads differently from the main request flow.
        agents
          .filter((c) => c.parent === a.key)
          .forEach((c) => {
            e.push({
              id: `${a.key}-${c.key}`,
              source: a.key,
              target: c.key,
              animated: isHot(c.key),
              style: {
                stroke: isHot(c.key) ? "#ec407a" : "#d5dae6",
                strokeWidth: 1.5,
                strokeDasharray: "4 3",
              },
            });
          });
        e.push({
          id: `${a.key}-out`,
          source: a.key,
          target: a.reviewPolicy === "human_review" ? "review" : "tickets",
          animated: isHot(a.key),
          style: {
            stroke: a.reviewPolicy === "human_review" ? "#fb8c00" : "#43a047",
            strokeWidth: 2,
            opacity: isHot(a.key) ? 1 : 0.45,
          },
        });
      });
    return e;
  }, [agents, states]);

  const activeCount = Object.values(states).filter((s) => s === "active").length;
  const waitingCount = Object.values(states).filter((s) => s === "waiting").length;

  return (
    <div className="row">
      <div className="col-lg-8 mb-4">
        <div className="card">
          <div className="card-header pb-0 d-flex justify-content-between align-items-center">
            <div>
              <h6 className="mb-0">مركز العمليات الحيّ</h6>
              <p className="text-sm text-secondary mb-0">
                كل وكيل يضيء لحظة عمله فعليًا — مصدر البيانات هو نفسه سجل النظام، لا محاكاة.
              </p>
            </div>
            <div className="d-flex gap-2">
              <button
                className={`btn btn-sm mb-0 ${live ? "bg-gradient-primary" : "btn-outline-secondary"}`}
                onClick={() => (live ? setLive(false) : backToLive())}
              >
                {live ? "● مباشر" : "عودة للبث"}
              </button>
              <button className="btn btn-sm btn-outline-dark mb-0" onClick={startReplay}>
                إعادة تشغيل الأحداث
              </button>
            </div>
          </div>
          <div className="card-body pt-3">
            {history.length > 0 && (
              <div
                className="mb-3 p-3"
                style={{ background: "#fff8ec", border: "1px solid #f6dfb8", borderRadius: 10 }}
              >
                <div className="d-flex align-items-center gap-3 mb-2">
                  <button
                    className="btn btn-sm bg-gradient-dark mb-0"
                    style={{ minWidth: 78 }}
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? "إيقاف" : "▶ تشغيل"}
                  </button>
                  <span className="text-xs text-secondary">
                    الحدث <b className="mono">{cursor}</b> من{" "}
                    <b className="mono">{history.length}</b>
                  </span>
                  {history[Math.min(cursor, history.length - 1)] && (
                    <span className="text-xs text-secondary mono">
                      {new Date(
                        history[Math.min(cursor, history.length - 1)].createdAt
                      ).toLocaleString("ar-SA")}
                    </span>
                  )}
                  <span className="text-xs text-secondary ms-auto">
                    السرعة
                    <select
                      className="form-select form-select-sm d-inline-block ms-1"
                      style={{ width: 66 }}
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      <option value={1}>×1</option>
                      <option value={2}>×2</option>
                      <option value={4}>×4</option>
                      <option value={8}>×8</option>
                    </select>
                  </span>
                </div>
                <input
                  type="range"
                  className="form-range"
                  min={0}
                  max={history.length}
                  value={cursor}
                  onChange={(e) => scrubTo(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <p className="text-xs text-secondary mb-0">
                  إعادة تشغيل حقيقية من سجل الأحداث المحفوظ — نفس البيانات التي شغّلت النظام وقتها.
                </p>
              </div>
            )}
            <div style={{ height: "calc(100vh - 320px)", minHeight: 460, borderRadius: 6, overflow: "hidden", background: "#0E0B14", border: "1px solid #2C2140" }}>
              <ReactFlow
                nodes={nodes}
                onNodesChange={onNodesChange}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                proOptions={{ hideAttribution: true }}
                onNodeClick={(_, n) => {
                  const found = agents.find((a) => a.key === n.id);
                  setSelected(found ?? null);
                }}
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#dfe3ee" />
                <Controls showInteractive={false} position="bottom-left" />
              </ReactFlow>
            </div>
            <div className="d-flex gap-4 mt-3 text-xs text-secondary">
              <span>وكلاء نشطون: <b className="mono">{activeCount}</b></span>
              <span>بانتظار قرار بشري: <b className="mono">{waitingCount}</b></span>
              <span>أحداث مستلمة: <b className="mono">{feed.length}</b></span>
            </div>
          </div>
        </div>
      </div>

      <div className="col-lg-4 mb-4">
        {selected && (
          <div className="card mb-3">
            <div className="card-header pb-0 d-flex justify-content-between align-items-start">
              <div>
                <h6 className="mb-0">{selected.nameAr}</h6>
                <p className="text-xs text-secondary mb-0 mono">{selected.key}</p>
              </div>
              <button className="btn btn-link p-0 mb-0 text-secondary" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className="card-body pt-2">
              <p className="text-sm mb-2">{selected.roleAr}</p>
              <p className="text-xs text-secondary mb-1">
                <b>السياسة:</b>{" "}
                {selected.reviewPolicy === "human_review" ? "ينتظر موافقة بشرية" : "تنفيذ فوري"}
              </p>
              <p className="text-xs text-secondary mb-1">
                <b>النوايا:</b> <span className="mono">{selected.handlesIntents.join(", ")}</span>
              </p>
              <p className="text-xs text-secondary mb-0">
                <b>الأدوات:</b> <span className="mono">{selected.tools.join(", ")}</span>
              </p>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header pb-0">
            <h6 className="mb-0">سجل النشاط الحيّ</h6>
            <p className="text-sm text-secondary mb-0">أحدث الأحداث أولاً</p>
          </div>
          <div className="card-body pt-2" style={{ maxHeight: "calc(100vh - 320px)", minHeight: 460, overflowY: "auto" }}>
            {feed.length === 0 && <p className="text-sm text-secondary">لا يوجد نشاط بعد.</p>}
            {feed.map((evt) => (
              <div key={evt.seq} className="d-flex gap-2 py-2 border-bottom">
                <span className="text-xs text-secondary mono" style={{ minWidth: 58 }}>
                  {new Date(evt.createdAt).toLocaleTimeString("ar-SA", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="text-sm">{describe(evt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
