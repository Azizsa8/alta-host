/**
 * The agent fleet as declarative, inspectable configuration — what the
 * Operations Center renders and what /api/agents exposes. The orchestrator's
 * dispatch switch must stay consistent with handlesIntents here (Phase 1B
 * replaces the switch by driving dispatch FROM this registry via Mastra).
 */
export interface AgentDefinition {
  key: string;
  name: string;
  nameAr: string;
  department: "reception" | "guest_service" | "housekeeping" | "maintenance" | "supervisor";
  role: string;
  roleAr: string;
  riskLevel: "low" | "guest_facing";
  reviewPolicy: "immediate" | "human_review";
  handlesIntents: string[];
  tools: string[];
  parent?: string;
}

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    key: "concierge_supervisor",
    name: "Concierge Supervisor",
    nameAr: "المنسّق الرئيسي",
    department: "supervisor",
    role: "Routes each extracted intent to the correct specialist agent; one guest message may fan out to several agents.",
    roleAr: "يوزّع كل نية مستخرجة على الوكيل المختص؛ رسالة واحدة قد تتفرع لعدة وكلاء.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["*"],
    tools: ["intent_engine", "dispatch"],
  },
  {
    key: "reception",
    name: "Reception Agent",
    nameAr: "وكيل الاستقبال",
    department: "reception",
    role: "Checkout extensions and booking changes against the live PMS; every guest-facing reply waits for human approval.",
    roleAr: "تمديد الخروج وتعديل الحجوزات على نظام الفندق مباشرة؛ كل رد يمر بالمراجعة البشرية.",
    riskLevel: "guest_facing",
    reviewPolicy: "human_review",
    handlesIntents: ["booking.extend_stay", "reception.faq"],
    tools: ["pms.getReservation", "pms.extendCheckout", "review_queue"],
    parent: "concierge_supervisor",
  },
  {
    key: "guest_service",
    name: "Guest Service Agent",
    nameAr: "وكيل خدمة النزلاء",
    department: "guest_service",
    role: "Complaints and general requests; detects sentiment and urgency; replies wait for human approval.",
    roleAr: "الشكاوى والطلبات العامة؛ يرصد المشاعر ودرجة الإلحاح؛ ردوده تمر بالمراجعة البشرية.",
    riskLevel: "guest_facing",
    reviewPolicy: "human_review",
    handlesIntents: ["guest_service.complaint"],
    tools: ["sentiment", "review_queue", "ticketing"],
    parent: "concierge_supervisor",
  },
  {
    key: "housekeeping",
    name: "Housekeeping Agent",
    nameAr: "وكيل التدبير المنزلي",
    department: "housekeeping",
    role: "Room-cleaning requests: creates the ticket and confirms to the guest immediately (no guest-facing risk).",
    roleAr: "طلبات التنظيف: ينشئ التذكرة ويؤكد للنزيل فورًا (بلا خطورة على النزيل).",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["housekeeping.clean_room"],
    tools: ["ticketing", "guest_language"],
    parent: "concierge_supervisor",
  },
  {
    key: "maintenance",
    name: "Maintenance Agent",
    nameAr: "وكيل الصيانة",
    department: "maintenance",
    role: "Fault reports: immediate ticket with SLA deadline; urgent reports auto-escalate.",
    roleAr: "بلاغات الأعطال: تذكرة فورية بمهلة استجابة؛ العاجل يُصعَّد تلقائيًا.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["maintenance.report_issue"],
    tools: ["ticketing", "sla_escalation", "guest_language"],
    parent: "concierge_supervisor",
  },
];
