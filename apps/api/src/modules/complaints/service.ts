import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import { emitEvent } from "../events/bus.js";

export const COMPLAINT_CATEGORIES = [
  "cleanliness",
  "staff",
  "noise",
  "food",
  "facilities",
  "billing",
  "safety",
  "general",
] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const CASE_STATUSES = ["open", "investigating", "action_planned", "resolved", "escalated"] as const;

/**
 * Category detection, and the phrases that mean "I am about to tell the
 * internet". The second list is the one that matters: a guest who says
 * «بكتب تقييم» has announced the deadline, and the case must jump the queue
 * before the window closes.
 */
const CATEGORY_PATTERNS: Array<{ category: string; re: RegExp }> = [
  { category: "safety", re: /سلامة|خطر|حريق|طوارئ|إصابة|كهرب|safety|fire|danger|injur|emergency/i },
  { category: "cleanliness", re: /نظاف|وسخ|متسخ|شعر|حشر|رائحة|clean|dirty|smell|insect|stain/i },
  { category: "billing", re: /فاتور|مبلغ|خصم|سعر|رسوم|دفع|bill|charge|refund|price|overcharg/i },
  { category: "noise", re: /ضجيج|صوت|إزعاج|صخب|noise|loud/i },
  { category: "food", re: /طعام|أكل|فطور|مطعم|بارد|food|breakfast|meal|restaurant/i },
  { category: "facilities", re: /مكيف|مصعد|مسبح|واي فاي|ماء|كهرباء|ac\b|elevator|pool|wifi|water/i },
  { category: "staff", re: /موظف|استقبال|خدمة|معامل|احترام|staff|service|rude|reception/i },
];

/** Explicit intent to go public — the reputation clock starts here. */
const PUBLIC_THREAT = /تقييم|أقيّم|بكتب|سوشال|تويتر|قوقل|جوجل|review|tripadvisor|google|social|post about|tell everyone/i;
// Arabic negativity carries gender and hamza variants — matching only
// "سيء جدا" missed "سيئة جدا", which is how a guest actually writes it.
const ANGER = /زعلان|غاضب|سيئ|سيء|أسوأ|مقرف|فظيع|كارث|terrible|awful|worst|disgusting|unacceptable|furious/i;
const LEGAL = /محامي|قانون|شكوى رسمية|بلاغ|وزارة|lawyer|legal|authorities|ministry|sue/i;

export interface Triage {
  category: string;
  severity: (typeof SEVERITIES)[number];
  reputationRisk: number;
  signals: string[];
}

/**
 * Scores how likely this complaint becomes a public review, and how fast
 * someone must move. Deterministic and inspectable — a hotel manager can
 * read WHY a case was rated critical, which matters more than a fractional
 * accuracy gain from an opaque model.
 */
export function triageComplaint(text: string, stars?: number): Triage {
  const signals: string[] = [];
  let risk = 20;

  const category = CATEGORY_PATTERNS.find((p) => p.re.test(text))?.category ?? "general";
  if (category === "safety") {
    risk += 45;
    signals.push("يمسّ السلامة");
  }
  if (category === "billing") {
    risk += 20;
    signals.push("نزاع مالي");
  }
  if (PUBLIC_THREAT.test(text)) {
    risk += 35;
    signals.push("النزيل لمّح لنشر تقييم علني");
  }
  if (ANGER.test(text)) {
    risk += 20;
    signals.push("لغة غاضبة");
  }
  if (LEGAL.test(text)) {
    risk += 30;
    signals.push("تلويح بإجراء رسمي");
  }
  if (typeof stars === "number" && stars <= 2) {
    risk += 25;
    signals.push(`تقييم ${stars} نجوم`);
  }
  if (text.length > 400) {
    risk += 5;
    signals.push("شكوى مفصّلة");
  }
  risk = Math.max(0, Math.min(100, risk));

  // Safety and legal exposure are critical regardless of the arithmetic —
  // a calm, short "the fire door was locked" must not score as medium.
  const severity: Triage["severity"] =
    category === "safety" || LEGAL.test(text) || risk >= 80
      ? "critical"
      : risk >= 60
        ? "high"
        : risk >= 35
          ? "medium"
          : "low";

  return { category, severity, reputationRisk: risk, signals };
}

/**
 * The five whys, proposed from the category so the investigator starts from
 * a real hypothesis chain instead of a blank form. These are QUESTIONS, not
 * conclusions — the human answers them and the answers become the record.
 */
const WHY_TEMPLATES: Record<string, string[]> = {
  cleanliness: [
    "لماذا لم تكن الغرفة على مستوى النظافة المطلوب؟",
    "لماذا لم يكتشف المشرف ذلك قبل تسليم الغرفة؟",
    "هل كان وقت التجهيز كافيًا لعدد الغرف المسندة؟",
    "هل قائمة الفحص مطبّقة فعليًا أم توقيع شكلي؟",
    "ما الذي يمنع تكرارها في نفس المناوبة غدًا؟",
  ],
  staff: [
    "ما الذي قيل أو حدث بالضبط من وجهة نظر النزيل؟",
    "هل كان الموظف مدرَّبًا على هذا الموقف تحديدًا؟",
    "هل كان تحت ضغط تشغيلي (نقص عمالة، ذروة وصول)؟",
    "هل الصلاحية الممنوحة له تكفي لحل المشكلة فورًا؟",
    "ما التدريب أو التفويض الذي يمنع التكرار؟",
  ],
  facilities: [
    "ما العطل الفني بالتحديد؟",
    "هل سبق الإبلاغ عنه ولم يُصلح؟",
    "هل الصيانة الوقائية مجدولة لهذا الأصل؟",
    "هل قطعة الغيار متوفرة محليًا أم تتطلب طلبًا؟",
    "ما الذي يجعل الاكتشاف يسبق شكوى النزيل؟",
  ],
  billing: [
    "ما البند محل الاعتراض؟",
    "هل أُبلغ النزيل به قبل الإقامة أو عند الوصول؟",
    "هل السياسة معروضة بوضوح في وقت الحجز؟",
    "هل الخطأ بشري أم في إعداد النظام؟",
    "ما الضابط الذي يمنع تكرار نفس البند؟",
  ],
  safety: [
    "ما الخطر المحدد وأين موقعه بالضبط؟",
    "منذ متى وهو قائم، ومن كان يفترض أن يكتشفه؟",
    "هل فحص السلامة الدوري مطبّق وموثّق؟",
    "هل يوجد خطر مماثل في مواقع أخرى بالمبنى؟",
    "ما الإجراء الفوري الذي يزيل الخطر اليوم لا غدًا؟",
  ],
  noise: [
    "مصدر الضجيج: نزيل آخر، صيانة، أم خارجي؟",
    "هل سياسة الهدوء معلنة ومطبّقة؟",
    "هل عزل الغرفة مطابق للمواصفة؟",
    "هل كان بالإمكان نقل النزيل فورًا؟",
    "ما الذي يمنع إسناد غرفة مجاورة لمصدر ضجيج معروف؟",
  ],
  food: [
    "ما الصنف والوقت بالتحديد؟",
    "هل تجاوز وقت العرض الآمن؟",
    "هل درجات الحرارة مسجّلة في السجل؟",
    "هل الكمية المحضّرة تناسب الإشغال؟",
    "ما ضابط الجودة قبل التقديم؟",
  ],
  general: [
    "ما الذي حدث بالضبط من وجهة نظر النزيل؟",
    "لماذا لم يُكتشف قبل أن يشتكي؟",
    "ما العملية التي كان يفترض أن تمنعه؟",
    "لماذا لم تعمل تلك العملية هذه المرة؟",
    "ما التغيير الذي يمنع التكرار؟",
  ],
};

/**
 * Action plans that actually cut the cause, keyed by category and severity.
 * `dueInHours` encodes urgency: a safety action due in 48 hours is not an
 * action plan, it is a paper trail.
 */
const ACTION_TEMPLATES: Record<string, Array<{ action: string; dueInHours: number }>> = {
  safety: [
    { action: "عزل الموقع وإزالة الخطر فورًا", dueInHours: 1 },
    { action: "فحص كل المواقع المماثلة في المبنى", dueInHours: 24 },
    { action: "تحديث جدول فحص السلامة وتوثيق نتيجته", dueInHours: 72 },
  ],
  cleanliness: [
    { action: "إعادة تجهيز الغرفة وتفتيشها بمشرف قبل التسليم", dueInHours: 3 },
    { action: "مراجعة عدد الغرف المسندة لكل موظف في المناوبة", dueInHours: 48 },
    { action: "تفعيل قائمة فحص مصوّرة قبل تسليم أي غرفة", dueInHours: 168 },
  ],
  staff: [
    { action: "استماع لرواية الموظف وتوثيقها دون عقاب فوري", dueInHours: 24 },
    { action: "تدريب قصير على السيناريو المحدد للفريق كله", dueInHours: 168 },
    { action: "رفع سقف الصلاحية لحل هذه الحالة دون تصعيد", dueInHours: 168 },
  ],
  facilities: [
    { action: "أمر عمل صيانة بأولوية مرتفعة على الأصل المعطل", dueInHours: 4 },
    { action: "فحص الأصول المماثلة في نفس الدور", dueInHours: 48 },
    { action: "إدراج الأصل في الصيانة الوقائية الدورية", dueInHours: 168 },
  ],
  billing: [
    { action: "مراجعة الفاتورة بندًا بندًا مع النزيل", dueInHours: 4 },
    { action: "تصحيح إعداد النظام إن كان الخطأ في التسعير", dueInHours: 48 },
    { action: "إبراز السياسة في تأكيد الحجز وعند الوصول", dueInHours: 168 },
  ],
  noise: [
    { action: "عرض نقل الغرفة فورًا إن توفرت بديلة", dueInHours: 1 },
    { action: "تنبيه مصدر الضجيج وتطبيق سياسة الهدوء", dueInHours: 6 },
    { action: "وسم الغرف المجاورة لمصادر الضجيج في نظام الإسناد", dueInHours: 168 },
  ],
  food: [
    { action: "سحب الصنف ومراجعة سجل درجات الحرارة", dueInHours: 2 },
    { action: "مراجعة كميات التحضير مقابل الإشغال", dueInHours: 48 },
    { action: "توثيق فحص جودة قبل كل خدمة", dueInHours: 168 },
  ],
  general: [
    { action: "التواصل المباشر مع النزيل وإغلاق الحلقة معه", dueInHours: 4 },
    { action: "تحديد العملية التي فشلت وتوثيقها", dueInHours: 48 },
    { action: "تعديل الإجراء لمنع التكرار", dueInHours: 168 },
  ],
};

type Actor = { staffId: string; name: string; propertyId: string };

/**
 * Captures a complaint as a case BEFORE it becomes public. This is the whole
 * point of the agent: the window between an unhappy guest and a one-star
 * review is where a hotel's reputation is actually defended.
 */
export async function captureComplaint(params: {
  propertyId: string;
  text: string;
  source?: "whatsapp" | "review" | "staff";
  guestId?: string;
  conversationId?: string;
  stars?: number;
}) {
  const triage = triageComplaint(params.text, params.stars);
  const whys = WHY_TEMPLATES[triage.category] ?? WHY_TEMPLATES.general;

  const kase = await prisma.complaintCase.create({
    data: {
      propertyId: params.propertyId,
      guestId: params.guestId,
      conversationId: params.conversationId,
      source: params.source ?? "whatsapp",
      text: params.text,
      category: triage.category,
      severity: triage.severity,
      reputationRisk: triage.reputationRisk,
      rcaWhy: whys.map((q) => ({ question: q, answer: "" })),
    },
  });

  await emitEvent(params.propertyId, {
    type: "complaint.captured",
    caseId: kase.id,
    category: kase.category,
    severity: kase.severity,
    reputationRisk: kase.reputationRisk,
  });

  // A case likely to go public is an operational emergency, not a queue item.
  if (triage.reputationRisk >= 60 || triage.severity === "critical") {
    await emitEvent(params.propertyId, {
      type: "complaint.reputation_risk",
      caseId: kase.id,
      reputationRisk: kase.reputationRisk,
      signals: triage.signals,
      preview: params.text.slice(0, 140),
    });
  }
  return { kase, triage };
}

/** Proposed action plan for a case — the human edits and owns it. */
export function proposeActions(category: string, severity: string) {
  const base = ACTION_TEMPLATES[category] ?? ACTION_TEMPLATES.general;
  // Critical cases compress every deadline: same actions, less time.
  const factor = severity === "critical" ? 0.25 : severity === "high" ? 0.5 : 1;
  const now = Date.now();
  return base.map((a) => ({
    action: a.action,
    owner: "",
    dueAt: new Date(now + a.dueInHours * factor * 3600 * 1000).toISOString(),
    done: false,
  }));
}

export async function ownCase(propertyId: string, id: string) {
  const kase = await prisma.complaintCase.findUnique({ where: { id } });
  if (!kase || kase.propertyId !== propertyId) return null;
  return kase;
}

/** Records RCA answers and the root cause the investigator concluded. */
export async function recordRca(params: {
  actor: Actor;
  caseId: string;
  answers: Array<{ question: string; answer: string }>;
  rootCause: string;
  contributing?: string[];
}): Promise<{ ok: true; actions: unknown[] } | { ok: false; status: number; error: string }> {
  const kase = await ownCase(params.actor.propertyId, params.caseId);
  if (!kase) return { ok: false, status: 404, error: "case not found" };
  if (kase.status === "resolved") return { ok: false, status: 409, error: "case already resolved" };
  if (!params.rootCause.trim()) return { ok: false, status: 422, error: "root cause is required" };

  const actions = proposeActions(kase.category, kase.severity);
  await prisma.complaintCase.update({
    where: { id: kase.id },
    data: {
      rcaWhy: params.answers,
      rootCause: params.rootCause,
      contributing: params.contributing ?? [],
      actions,
      status: "action_planned",
    },
  });
  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "complaint.rca_recorded",
    resourceType: "ComplaintCase",
    resourceId: kase.id,
    outcome: "success",
    metadata: { category: kase.category, severity: kase.severity },
  });
  await emitEvent(kase.propertyId, { type: "complaint.status", caseId: kase.id, status: "action_planned" });
  return { ok: true, actions };
}

export async function updateCase(params: {
  actor: Actor;
  caseId: string;
  status?: (typeof CASE_STATUSES)[number];
  actions?: Array<{ action: string; owner: string; dueAt: string; done: boolean }>;
  preventive?: string;
  ownerId?: string;
  resolutionNote?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const kase = await ownCase(params.actor.propertyId, params.caseId);
  if (!kase) return { ok: false, status: 404, error: "case not found" };

  // A case cannot be closed on optimism: resolving requires a stated root
  // cause and at least one completed action. Otherwise "resolved" would
  // only mean "we stopped looking".
  if (params.status === "resolved") {
    const actions = (params.actions ?? (kase.actions as Array<{ done?: boolean }> | null) ?? []) as Array<{ done?: boolean }>;
    if (!kase.rootCause.trim()) {
      return { ok: false, status: 422, error: "cannot resolve without a recorded root cause" };
    }
    if (!actions.some((a) => a.done)) {
      return { ok: false, status: 422, error: "cannot resolve before at least one action is done" };
    }
  }

  await prisma.complaintCase.update({
    where: { id: kase.id },
    data: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.actions ? { actions: params.actions } : {}),
      ...(params.preventive !== undefined ? { preventive: params.preventive } : {}),
      ...(params.ownerId !== undefined ? { ownerId: params.ownerId } : {}),
      ...(params.resolutionNote !== undefined ? { resolutionNote: params.resolutionNote } : {}),
      ...(params.status === "resolved" ? { resolvedAt: new Date() } : {}),
    },
  });
  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: `complaint.${params.status ?? "updated"}`,
    resourceType: "ComplaintCase",
    resourceId: kase.id,
    outcome: "success",
  });
  if (params.status) {
    await emitEvent(kase.propertyId, { type: "complaint.status", caseId: kase.id, status: params.status });
  }
  return { ok: true };
}

/**
 * Pattern view: which root causes keep producing complaints. One angry guest
 * is an incident; the same root cause three times is a broken process, and
 * that distinction is what turns cases into management decisions.
 */
export async function complaintPatterns(propertyId: string) {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const cases = await prisma.complaintCase.findMany({
    where: { propertyId, createdAt: { gte: since } },
    select: { category: true, severity: true, rootCause: true, status: true, reputationRisk: true, resolvedAt: true, createdAt: true, publicReviewId: true },
  });

  const byCategory: Record<string, number> = {};
  const byRootCause: Record<string, number> = {};
  let resolvedMs = 0;
  let resolvedCount = 0;
  for (const c of cases) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    const rc = c.rootCause.trim();
    if (rc) byRootCause[rc] = (byRootCause[rc] ?? 0) + 1;
    if (c.resolvedAt) {
      resolvedMs += c.resolvedAt.getTime() - c.createdAt.getTime();
      resolvedCount++;
    }
  }

  return {
    windowDays: 90,
    total: cases.length,
    open: cases.filter((c) => c.status !== "resolved").length,
    highRisk: cases.filter((c) => c.reputationRisk >= 60).length,
    byCategory,
    // Only causes seen more than once — a list of singletons is noise.
    repeatRootCauses: Object.entries(byRootCause)
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([cause, count]) => ({ cause, count })),
    medianResolutionHours: resolvedCount > 0 ? Math.round(resolvedMs / resolvedCount / 3600000) : null,
    containedPct:
      cases.length > 0
        ? Math.round((cases.filter((c) => c.status === "resolved" && !c.publicReviewId).length / cases.length) * 100)
        : null,
  };
}
