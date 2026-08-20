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
  /** Key of the agent this reports to. Absent only for the supervisor. */
  parent?: string;
  /** 0 supervisor, 1 department specialist, 2 sub-agent. */
  depth: 0 | 1 | 2;
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
    depth: 0,
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
    depth: 1,
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
    depth: 1,
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
    depth: 1,
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
    depth: 1,
  },

  // ---- sub-agents -------------------------------------------------------
  // Each wraps a step that already gated the outcome; naming them makes the
  // reasoning behind a decision inspectable. Nothing here invents work.
  {
    key: "reception.reservation_lookup",
    name: "Reservation Lookup",
    nameAr: "التحقق من الحجز",
    department: "reception",
    role: "Confirms the guest has an active stay before anything can be extended. Blocks the request when there is none.",
    roleAr: "يتأكد من وجود حجز فعّال قبل أي تمديد. يوقف الطلب إذا لم يوجد.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["booking.extend_stay"],
    tools: ["pms.getReservationForGuest"],
    parent: "reception",
    depth: 2,
  },
  {
    key: "reception.billing_check",
    name: "Billing Check",
    nameAr: "التحقق من وسيلة الدفع",
    department: "reception",
    role: "A late checkout is chargeable, so a valid payment method is a hard precondition. Blocks the request when missing.",
    roleAr: "تمديد الخروج مدفوع، لذا وجود وسيلة دفع سارية شرط أساسي. يوقف الطلب عند غيابها.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["booking.extend_stay"],
    tools: ["pms.getBillingStatus"],
    parent: "reception",
    depth: 2,
  },
  {
    key: "housekeeping.staff_routing",
    name: "Housekeeping Routing",
    nameAr: "توجيه التدبير المنزلي",
    department: "housekeeping",
    role: "Finds an on-shift housekeeper to own the ticket. Reports when nobody is available rather than silently leaving it unassigned.",
    roleAr: "يجد موظف تدبير منزلي على رأس العمل لاستلام التذكرة، ويبلّغ عند عدم توفر أحد بدل تركها دون مسؤول.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["housekeeping.clean_room"],
    tools: ["staff_roster"],
    parent: "housekeeping",
    depth: 2,
  },
  {
    key: "maintenance.staff_routing",
    name: "Maintenance Routing",
    nameAr: "توجيه الصيانة",
    department: "maintenance",
    role: "Finds an on-shift technician to own the fault. Reports when nobody is available — an unassigned urgent fault is an operational risk.",
    roleAr: "يجد فنيًا على رأس العمل لاستلام البلاغ، ويبلّغ عند عدم توفر أحد — بلاغ عاجل دون مسؤول خطر تشغيلي.",
    riskLevel: "low",
    reviewPolicy: "immediate",
    handlesIntents: ["maintenance.report_issue"],
    tools: ["staff_roster", "sla_escalation"],
    parent: "maintenance",
    depth: 2,
  },
];
