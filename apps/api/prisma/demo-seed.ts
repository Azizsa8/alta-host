/**
 * ALTA Demo Seed — Full client-demo data
 * Populates every dashboard section with realistic Arabic/English data.
 *
 * Usage (inside the container):
 *   npx tsx prisma/demo-seed.ts
 *
 * Or from the host:
 *   docker compose exec api npx tsx prisma/demo-seed.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { recordAudit } from "../src/modules/audit/service.js";

const prisma = new PrismaClient();
const DEMO_PASSWORD_HASH = bcrypt.hashSync("alta-demo-2026", 10);

function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000); }
function hoursAgo(n: number) { return new Date(Date.now() - n * 3_600_000); }
function daysFromNow(n: number) { return new Date(Date.now() + n * 86_400_000); }

async function main() {
  console.log("🌱 ALTA Demo Seed — Starting...\n");

  // ─── Properties ─────────────────────────────────────────────────────────
  const prop1 = await prisma.property.upsert({
    where: { id: "demo-property" },
    update: { name: "فندق بوليفار الرياض" },
    create: { id: "demo-property", name: "فندق بوليفار الرياض", pmsType: "mock" },
  });

  await prisma.property.upsert({
    where: { id: "demo-property-2" },
    update: { name: "أجنحة كورنيش جدة" },
    create: { id: "demo-property-2", name: "أجنحة كورنيش جدة", pmsType: "mock" },
  });

  // ─── Staff ───────────────────────────────────────────────────────────────
  await prisma.property.upsert({
    where: { id: "alta-platform" },
    update: {},
    create: { id: "alta-platform", name: "ALTA Platform" },
  });
  await prisma.staffMember.upsert({
    where: { username: "alta" },
    update: {},
    create: { propertyId: "alta-platform", name: "ALTA Admin", role: "alta_admin", username: "alta", passwordHash: DEMO_PASSWORD_HASH },
  });

  const staff1Defs = [
    { name: "فهد الشمري (الاستقبال)", role: "reception", username: "fahad", department: "reception" },
    { name: "نورة العتيبي (التدبير المنزلي)", role: "housekeeping", username: "noura", department: "housekeeping" },
    { name: "سالم الدوسري (الصيانة)", role: "maintenance", username: "salem", department: "maintenance" },
    { name: "ليلى المطيري (خدمة النزلاء)", role: "guest_service", username: "layla", department: "guest_service" },
    { name: "ريم الغامدي (المدير)", role: "hotel_manager", username: "reem", department: null },
    { name: "طارق البقمي (تقني)", role: "technician", username: "tariq", department: "maintenance" },
    { name: "دانة الزهراني (تسويق)", role: "marketing_manager", username: "dana", department: null },
    { name: "وليد السبيعي (المدير العام)", role: "general_manager", username: "waleed", department: null },
  ];

  const staff1: Record<string, string> = {};
  for (const s of staff1Defs) {
    let member = await prisma.staffMember.findFirst({ where: { propertyId: prop1.id, username: s.username } });
    if (!member) {
      member = await prisma.staffMember.create({
        data: { propertyId: prop1.id, name: s.name, role: s.role, department: s.department, onShift: true, username: s.username, passwordHash: DEMO_PASSWORD_HASH },
      });
    } else {
      await prisma.staffMember.update({ where: { id: member.id }, data: { name: s.name } });
    }
    staff1[s.username] = member.id;
  }

  // ─── Guests & Reservations ───────────────────────────────────────────────
  const guestDefs = [
    { wid: "966501111001", name: "أحمد العمري", dialect: "saudi", room: "412", ci: daysAgo(2), co: daysFromNow(2) },
    { wid: "966501111002", name: "سارة المالكي", dialect: "saudi", room: "318", ci: daysAgo(1), co: daysFromNow(3) },
    { wid: "966501111003", name: "محمد الجابر", dialect: "saudi", room: "205", ci: daysAgo(3), co: daysFromNow(1) },
    { wid: "966501111004", name: "نورا الرشيد", dialect: "saudi", room: "510", ci: daysAgo(1), co: daysFromNow(4) },
    { wid: "966501111005", name: "فيصل الحربي", dialect: "saudi", room: "101", ci: daysAgo(4), co: daysFromNow(1) },
    { wid: "971501111006", name: "Lena Wagner", dialect: "en", room: "701", ci: daysAgo(1), co: daysFromNow(5) },
    { wid: "447501111007", name: "James O'Connor", dialect: "en", room: "602", ci: daysAgo(2), co: daysFromNow(2) },
    { wid: "966501111008", name: "عبدالله الغامدي", dialect: "saudi", room: "304", ci: daysAgo(5), co: daysFromNow(0) },
  ];

  const guests: { id: string; name: string; room: string }[] = [];
  for (let i = 0; i < guestDefs.length; i++) {
    const g = guestDefs[i];
    const guest = await prisma.guest.upsert({
      where: { whatsappId: g.wid },
      update: { name: g.name },
      create: { propertyId: prop1.id, whatsappId: g.wid, name: g.name, preferredDialect: g.dialect },
    });
    await prisma.reservation.upsert({
      where: { id: `demo-res-${i + 1}` },
      update: {},
      create: { id: `demo-res-${i + 1}`, guestId: guest.id, propertyId: prop1.id, roomNumber: g.room, checkIn: g.ci, checkOut: g.co, status: "confirmed" },
    });
    guests.push({ id: guest.id, name: g.name, room: g.room });
  }

  // ─── Conversations + Messages + Intents + Tickets + Review Queue ─────────
  const ticketDefs = [
    { gi: 0, inbound: "أحتاج تنظيف الغرفة من فضلك، وتغيير المناشف", outbound: "تم استلام طلبك، سيصل فريق التدبير المنزلي خلال 30 دقيقة. ✅", type: "housekeeping.clean_room", dept: "housekeeping", summary: "طلب تنظيف الغرفة 412 وتغيير المناشف", status: "done", urgency: "normal", sentiment: "neutral", hBack: 5, sk: "noura" },
    { gi: 1, inbound: "هل يمكن الحصول على وسادة إضافية؟", outbound: "بالتأكيد سارة! سيتم توصيل الوسادة خلال 15 دقيقة. 🛏️", type: "housekeeping.extra_amenities", dept: "housekeeping", summary: "طلب وسادة إضافية للغرفة 318", status: "done", urgency: "normal", sentiment: "positive", hBack: 8, sk: "noura" },
    { gi: 4, inbound: "الغرفة لم تُنظَّف منذ يومين، هذا غير مقبول!", outbound: null, type: "housekeeping.escalation", dept: "housekeeping", summary: "شكوى عدم تنظيف الغرفة 101 ليومين", status: "in_progress", urgency: "high", sentiment: "negative", hBack: 2, sk: "noura", review: true, draft: "نعتذر بشدة فيصل. سيتولى مشرف التدبير المنزلي متابعة غرفتك فوراً وسنوفر لك إقامة مريحة." },
    { gi: 2, inbound: "التكييف في الغرفة لا يعمل بشكل صحيح، يصدر صوتاً غريباً", outbound: "تم فتح طلب صيانة طارئ. سيصل الفني خلال 20 دقيقة. 🔧", type: "maintenance.hvac", dept: "maintenance", summary: "عطل في التكييف غرفة 205 – صوت غريب", status: "in_progress", urgency: "high", sentiment: "negative", hBack: 3, sk: "tariq" },
    { gi: 3, inbound: "الحمام يوجد به تسريب مياه من الصنبور", outbound: "تم تسجيل البلاغ. سيصل فريق الصيانة في أقرب وقت. 💧", type: "maintenance.plumbing", dept: "maintenance", summary: "تسريب صنبور الحمام غرفة 510", status: "open", urgency: "high", sentiment: "neutral", hBack: 1, sk: "tariq" },
    { gi: 6, inbound: "The TV remote control is not working in room 602", outbound: "Noted James! Our maintenance team will be there within 15 minutes with a new remote. 📺", type: "maintenance.electrical", dept: "maintenance", summary: "TV remote issue – Room 602", status: "done", urgency: "normal", sentiment: "neutral", hBack: 10, sk: "tariq" },
    { gi: 0, inbound: "أريد تمديد إقامتي يومين إضافيين", outbound: null, type: "booking.extend_stay", dept: "reception", summary: "طلب تمديد الإقامة يومين – الغرفة 412", status: "open", urgency: "normal", sentiment: "positive", hBack: 4, sk: "fahad", review: true, draft: "أهلاً أحمد! يسعدنا تمديد إقامتك. تاريخ المغادرة الجديد سيكون بعد يومين. هل تود تأكيد ذلك؟" },
    { gi: 5, inbound: "Can I get a late checkout until 2pm?", outbound: null, type: "booking.late_checkout", dept: "reception", summary: "Late checkout request 2pm – Room 701", status: "open", urgency: "normal", sentiment: "neutral", hBack: 1, sk: "fahad", review: true, draft: "Good morning Lena! We're happy to arrange a late checkout until 2:00 PM for Room 701. A surcharge of SAR 150 will apply. Shall we confirm?" },
    { gi: 2, inbound: "هل يمكن إضافة إفطار لليوم؟", outbound: "بالتأكيد محمد! تم إضافة وجبة الإفطار. يبدأ الإفطار الساعة 7 صباحاً في مطعم النخبة. 🍳", type: "dining.add_breakfast", dept: "guest_service", summary: "إضافة خدمة الإفطار لحجز الغرفة 205", status: "done", urgency: "normal", sentiment: "positive", hBack: 12, sk: "layla" },
    { gi: 7, inbound: "أحتاج سيارة لنقل من المطار غداً الساعة 8 صباحاً", outbound: null, type: "transport.arrange_transfer", dept: "guest_service", summary: "طلب توصيل مطار للغرفة 304", status: "open", urgency: "normal", sentiment: "neutral", hBack: 2, sk: "layla", review: true, draft: "أهلاً عبدالله! سنرتب لك سيارة فارهة للمطار غداً 8:00 صباحاً. رسوم التوصيل 120 ريال. هل تؤكد الحجز؟" },
    { gi: 1, inbound: "شكراً جزيلاً على الخدمة الرائعة!", outbound: "يسعدنا سماع ذلك سارة! نتطلع لاستقبالك مجدداً. 🌟", type: "feedback.positive", dept: "guest_service", summary: "إطراء إيجابي من النزيلة سارة", status: "done", urgency: "normal", sentiment: "positive", hBack: 24, sk: "layla" },
  ];

  for (const t of ticketDefs) {
    const g = guests[t.gi];
    const conv = await prisma.conversation.create({ data: { guestId: g.id, channel: "whatsapp", createdAt: hoursAgo(t.hBack + 0.5) } });
    const inMsg = await prisma.message.create({ data: { conversationId: conv.id, direction: "inbound", rawText: t.inbound, createdAt: hoursAgo(t.hBack) } });
    const intent = await prisma.intent.create({
      data: { messageId: inMsg.id, type: t.type, params: JSON.stringify({ room: g.room, guestName: g.name }), confidence: 0.93, sentiment: t.sentiment, urgency: t.urgency, createdAt: hoursAgo(t.hBack) },
    });

    if ((t as any).review) {
      await prisma.reviewItem.create({
        data: { intentId: intent.id, department: t.dept, draftReply: (t as any).draft ?? "", pendingAction: JSON.stringify({ type: t.type, params: { room: g.room } }), status: "pending", createdAt: hoursAgo(t.hBack) },
      });
    } else if (t.outbound) {
      await prisma.message.create({ data: { conversationId: conv.id, direction: "outbound", rawText: t.outbound, createdAt: hoursAgo(t.hBack - 0.1) } });
    }

    const staffId = staff1[t.sk];
    const slaHours = t.urgency === "high" ? 2 : 24;
    const ticket = await prisma.ticket.create({
      data: {
        intentId: intent.id, department: t.dept, status: t.status, summary: t.summary, assignedStaffId: staffId,
        slaDeadline: new Date(Date.now() - (t.hBack - slaHours) * 3_600_000),
        escalatedAt: (t.status === "open" && t.urgency === "high") ? hoursAgo(0.5) : null,
        createdAt: hoursAgo(t.hBack),
      },
    });
    if (t.status !== "open") {
      await prisma.agentAction.create({ data: { ticketId: ticket.id, agent: t.dept, action: t.status === "done" ? "ticket_resolved" : "ticket_in_progress", detail: t.summary, createdAt: hoursAgo(t.hBack - 0.2) } });
    }
  }

  // ─── Work Orders ─────────────────────────────────────────────────────────
  const workOrders = [
    { title: "استبدال مكيف غرفة 205", category: "hvac", priority: "critical", status: "in_progress", location: "غرفة 205", assigneeId: staff1["tariq"], createdBy: staff1["salem"], checklist: [{ item: "قطع التيار", done: true }, { item: "فحص الكمبروسر", done: true }, { item: "تعبئة الفريون", done: false }, { item: "اختبار التشغيل", done: false }], note: "تم التحقق من العطل. قطع الغيار في الطريق.", daysBack: 1 },
    { title: "إصلاح تسريب صنبور غرفة 510", category: "plumbing", priority: "high", status: "assigned", location: "غرفة 510 – الحمام", assigneeId: staff1["tariq"], createdBy: staff1["salem"], checklist: [{ item: "إغلاق صمام المياه", done: false }, { item: "استبدال الحشية", done: false }, { item: "اختبار عدم التسريب", done: false }], note: "بلاغ من النزيل عبر واتساب. أولوية عالية.", daysBack: 0.04 },
    { title: "صيانة دورية مصاعد المبنى أ", category: "electrical", priority: "normal", status: "awaiting_confirm", location: "مصاعد المبنى الرئيسي", assigneeId: staff1["tariq"], createdBy: staff1["reem"], checklist: [{ item: "فحص حبال الرفع", done: true }, { item: "تشحيم الأجزاء", done: true }, { item: "اختبار الأمان", done: true }, { item: "موافقة المدير", done: false }], note: "اكتملت الصيانة. بانتظار موافقة المدير.", daysBack: 3 },
    { title: "تجديد دهانات البهو الرئيسي", category: "furniture", priority: "low", status: "new", location: "البهو الرئيسي – الطابق الأرضي", assigneeId: null, createdBy: staff1["reem"], checklist: [{ item: "الحصول على عروض أسعار", done: false }, { item: "الموافقة على العرض", done: false }, { item: "جدولة العمل ليلاً", done: false }], note: "مقترح تجديد ديكور قبل موسم العطل.", daysBack: 2 },
    { title: "استبدال لمبات إضاءة الممر الثالث", category: "electrical", priority: "normal", status: "closed", location: "الممر – الطابق الثالث", assigneeId: staff1["tariq"], createdBy: staff1["salem"], checklist: [{ item: "تحديد اللمبات المحترقة", done: true }, { item: "توفير بديل LED", done: true }, { item: "التركيب والاختبار", done: true }], note: "تم الإنجاز بنجاح.", daysBack: 5, closedBy: staff1["tariq"] },
  ];

  for (const wo of workOrders) {
    const existing = await prisma.workOrder.findFirst({ where: { propertyId: prop1.id, title: wo.title } });
    if (existing) continue;
    const created = await prisma.workOrder.create({
      data: { propertyId: prop1.id, title: wo.title, category: wo.category, priority: wo.priority, status: wo.status, location: wo.location, assigneeId: wo.assigneeId ?? null, createdBy: wo.createdBy, checklist: wo.checklist, closedBy: (wo as any).closedBy ?? null, closedAt: (wo as any).closedBy ? daysAgo(wo.daysBack - 1) : null, createdAt: daysAgo(wo.daysBack) },
    });
    await prisma.workOrderUpdate.create({
      data: { workOrderId: created.id, authorId: wo.assigneeId ?? wo.createdBy, authorName: "طارق البقمي", note: wo.note, statusTo: wo.status, createdAt: daysAgo(wo.daysBack - 0.1) },
    });
  }

  // ─── Google Reviews ──────────────────────────────────────────────────────
  const googleReviews = [
    { eid: "gr-001", stars: 5, author: "أحمد العمري", text: "فندق رائع! الخدمة ممتازة والموظفون في غاية اللطف. الغرفة نظيفة ومريحة. سأعود بالتأكيد!", at: daysAgo(2), sentiment: "positive", topic: "staff", draft: "شكراً جزيلاً أحمد! يسعدنا أنك استمتعت بإقامتك. نتطلع لاستقبالك مجدداً في فندق بوليفار الرياض. 🌟", rs: "approved", by: "ريم الغامدي (المدير)" },
    { eid: "gr-002", stars: 4, author: "Lena Wagner", text: "Great location and friendly staff. The room was spacious and clean. The breakfast variety could be improved.", at: daysAgo(3), sentiment: "positive", topic: "facilities", draft: "Thank you Lena! We're glad you enjoyed your stay. We've noted your breakfast feedback. Hope to see you again! 😊", rs: "draft", by: null },
    { eid: "gr-003", stars: 2, author: "محمد السالم", text: "التكييف كان معطلاً طوال اليوم الأول ولم يُحل بسرعة. خدمة الغرف بطيئة جداً.", at: daysAgo(5), sentiment: "negative", topic: "facilities", draft: "نأسف جداً محمد على هذه التجربة. تكييف الغرفة والتأخر في الخدمة أمران لا نقبلهما. تم تحديث الإجراءات.", rs: "approved", by: "ريم الغامدي (المدير)" },
    { eid: "gr-004", stars: 5, author: "James O'Connor", text: "Exceptional service from start to finish. The concierge went above and beyond. Room was spotless. 10/10!", at: daysAgo(1), sentiment: "positive", topic: "staff", draft: "Thank you James! Our concierge team will be delighted to hear your kind words. Looking forward to hosting you again! 🏨", rs: "draft", by: null },
    { eid: "gr-005", stars: 3, author: "فاطمة الحسن", text: "الموقع ممتاز والفندق جميل من الخارج. لكن النظافة في الغرف تحتاج تحسين.", at: daysAgo(7), sentiment: "neutral", topic: "cleanliness", draft: "شكراً فاطمة. ملاحظتك قيّمة وتم توجيهها لمشرف التدبير المنزلي.", rs: "approved", by: "ريم الغامدي (المدير)" },
    { eid: "gr-006", stars: 5, author: "نورا الرشيد", text: "تجربة استثنائية! المسبح رائع والسبا احترافي. الإفطار لذيذ ومتنوع جداً.", at: hoursAgo(18), sentiment: "positive", topic: "facilities", draft: "يسعدنا جداً نورا أنك استمتعت بجميع مرافق الفندق! 💛", rs: "none", by: null },
  ];

  for (const gr of googleReviews) {
    await prisma.googleReview.upsert({
      where: { propertyId_externalId: { propertyId: prop1.id, externalId: gr.eid } },
      update: {},
      create: { propertyId: prop1.id, externalId: gr.eid, stars: gr.stars, text: gr.text, author: gr.author, reviewedAt: gr.at, sentiment: gr.sentiment, topic: gr.topic, draftReply: gr.draft, replyStatus: gr.rs, approvedBy: gr.by },
    });
  }

  // ─── Complaints ──────────────────────────────────────────────────────────
  const complaints = [
    { guestId: guests[2].id, text: "التكييف في الغرفة 205 يصدر ضوضاء عالية ولا يبرد بشكل كافٍ منذ ليلة أمس.", category: "facilities", severity: "high", risk: 72, status: "action_planned", rcaWhy: ["لم تخضع الوحدة لصيانة دورية", "انتهى عقد الصيانة ولم يُجدَّد"], rootCause: "غياب جدول الصيانة الوقائية لوحدات التكييف", actions: [{ action: "تبديل وحدة التكييف عاجل", owner: "tariq", dueAt: daysFromNow(1), done: false }], preventive: "تفعيل جدول صيانة وقائية شهرية مع تنبيهات تلقائية", ownerId: staff1["reem"], daysBack: 1 },
    { guestId: guests[4].id, text: "الغرفة 101 لم تُنظَّف منذ يومين، وطلبت المناشف ثلاث مرات ولم تصل.", category: "cleanliness", severity: "high", risk: 85, status: "investigating", rcaWhy: ["ضغط عمل مرتفع على التدبير المنزلي", "نقص كوادر بسبب إجازات"], rootCause: "نقص كوادر التدبير المنزلي", actions: [{ action: "زيارة الغرفة واعتذار رسمي", owner: "noura", dueAt: new Date(), done: false }], preventive: "رسم جدول الإجازات مسبقاً وتحديد الحد الأدنى للكوادر", ownerId: staff1["noura"], daysBack: 0.08 },
    { guestId: guests[5].id, text: "The WiFi in room 701 is extremely slow and keeps disconnecting. Unacceptable for a 5-star hotel.", category: "facilities", severity: "medium", risk: 55, status: "resolved", rcaWhy: ["نقطة الوصول في الطابق السابع تالفة", "غياب مراقبة الشبكة التلقائية"], rootCause: "عطل في نقطة الوصول بالطابق السابع", actions: [{ action: "استبدال نقطة الوصول", owner: "tariq", dueAt: daysAgo(1), done: true }], preventive: "تفعيل نظام مراقبة الشبكة وتنبيهات الانقطاع", ownerId: staff1["tariq"], daysBack: 2, resolvedAt: hoursAgo(6), note: "تم استبدال نقطة الوصول. السرعة عادت لوضعها الطبيعي." },
  ];

  for (const c of complaints) {
    const existing = await prisma.complaintCase.findFirst({ where: { propertyId: prop1.id, text: c.text } });
    if (existing) continue;
    await prisma.complaintCase.create({
      data: { propertyId: prop1.id, guestId: c.guestId, source: "whatsapp", text: c.text, category: c.category, severity: c.severity, reputationRisk: c.risk, status: c.status, rcaWhy: c.rcaWhy, rootCause: c.rootCause, actions: c.actions, preventive: c.preventive, ownerId: c.ownerId, resolvedAt: (c as any).resolvedAt ?? null, resolutionNote: (c as any).note ?? "", createdAt: daysAgo(c.daysBack) },
    });
  }

  // ─── Social Channels ─────────────────────────────────────────────────────
  const socialChannels = [
    { ch: "instagram", handle: "@riyadh_boulevard_hotel", enabled: true, connected: true, followers: 18400, reach: 124000, eng: 5800, ppw: 5, tone: "بصري، إلهامي، عربي أولاً", tags: ["#فندق_بوليفار", "#الرياض", "#RiyadhHotel"] },
    { ch: "tiktok", handle: "@boulevard_hotel_ruh", enabled: true, connected: true, followers: 32100, reach: 890000, eng: 41000, ppw: 4, tone: "ترفيهي، خلف الكواليس، شبابي", tags: ["#fypシ", "#سفر", "#فنادق"] },
    { ch: "facebook", handle: "Riyadh Boulevard Hotel", enabled: true, connected: true, followers: 9200, reach: 45000, eng: 1200, ppw: 3, tone: "رسمي، عائلي، أخبار الفندق", tags: ["#RiyadhHotel", "#فنادق_الرياض"] },
    { ch: "x", handle: "@BoulevardRUH", enabled: false, connected: false, followers: 3400, reach: 0, eng: 0, ppw: 2, tone: "سريع، رسمي، إخباري", tags: ["#Riyadh", "#Hotel"] },
    { ch: "linkedin", handle: "Riyadh Boulevard Hotel", enabled: true, connected: true, followers: 2800, reach: 18000, eng: 420, ppw: 2, tone: "احترافي، فرص عمل، أخبار الأعمال", tags: ["#Hospitality", "#SaudiTourism"] },
  ];

  for (const sc of socialChannels) {
    await prisma.socialChannel.upsert({
      where: { propertyId_channel: { propertyId: prop1.id, channel: sc.ch } },
      update: { followers: sc.followers, reach30d: sc.reach, engagement30d: sc.eng },
      create: { propertyId: prop1.id, channel: sc.ch, handle: sc.handle, enabled: sc.enabled, connected: sc.connected, connectedAt: sc.connected ? daysAgo(60) : null, connectedBy: sc.connected ? staff1["dana"] : null, followers: sc.followers, reach30d: sc.reach, engagement30d: sc.eng, postsPerWeek: sc.ppw, tone: sc.tone, hashtags: sc.tags, lastSyncedAt: sc.connected ? hoursAgo(2) : null },
    });
  }

  // ─── Content Items ────────────────────────────────────────────────────────
  const contentItems = [
    { idea: "إطلالة شروق الشمس من غرف الطابق العلوي", bodyAr: "✨ استيقظ على أجمل إطلالة في الرياض!\n\nغرفنا الفاخرة تمنحك منظراً بانورامياً لا مثيل له عند الفجر.\n\nاحجز الآن 📞 920-000-123\n\n#فندق_بوليفار #الرياض #فندق_فاخر", bodyEn: "", ch: "instagram", status: "published", pub: daysAgo(3), metrics: { likes: 1842, comments: 96, shares: 213 } },
    { idea: "جولة خلف الكواليس في مطبخنا مع الشيف", bodyAr: "🍽️ هل تساءلت كيف نُحضّر إفطارنا الشهير؟\n\nتعال في جولة مع شيفنا الكبير! 👨‍🍳\n\n#فندق_بوليفار #مطبخ", bodyEn: "", ch: "tiktok", status: "approved", sched: daysFromNow(1), metrics: {} },
    { idea: "عرض عائلي لعطلة نهاية الأسبوع", bodyAr: "👨‍👩‍👧‍👦 عطلة لا تُنسى!\n\n✅ غرفة فاخرة\n✅ إفطار مجاني للأطفال\n✅ مسبح مجاناً\n✅ خصم 20٪ على السبا\n\nاحجز الآن! ☎️ 920-000-123", bodyEn: "Family Weekend! Luxury room + free kids breakfast + pool + 20% spa discount.", ch: "facebook", status: "in_review", sched: daysFromNow(3), metrics: {} },
    { idea: "مقطع ريلز – تجربة السبا الفاخرة", bodyAr: "💆‍♀️ استسلم لتجربة استرخاء لا مثيل لها في سبا بوليفار…", bodyEn: "", ch: "instagram", status: "draft", metrics: {} },
    { idea: "احتفال بيوم التأسيس السعودي", bodyAr: "🇸🇦 بمناسبة يوم التأسيس السعودي المجيد…\n\nفندق بوليفار الرياض يرحب بضيوفه بعروض استثنائية!", bodyEn: "", ch: "instagram", status: "published", pub: daysAgo(10), metrics: { likes: 3201, comments: 187, shares: 445 } },
    { idea: "نصائح السفر للزائرين لمدينة الرياض", bodyAr: "", bodyEn: "🌍 Visiting Riyadh? Our top 5 tips:\n1. National Museum\n2. Diriyah\n3. Authentic Saudi cuisine\n4. Kingdom Centre\n5. Boulevard City\n\n#VisitRiyadh #SaudiTourism", ch: "linkedin", status: "idea", metrics: {} },
  ];

  for (const ci of contentItems) {
    const existing = await prisma.contentItem.findFirst({ where: { propertyId: prop1.id, idea: ci.idea } });
    if (existing) continue;
    await prisma.contentItem.create({
      data: { propertyId: prop1.id, idea: ci.idea, bodyAr: ci.bodyAr, bodyEn: ci.bodyEn, channel: ci.ch, status: ci.status, approvedBy: ["approved", "published"].includes(ci.status) ? staff1["dana"] : null, scheduledAt: (ci as any).sched ?? null, publishedAt: (ci as any).pub ?? null, resultUrl: ci.status === "published" ? `https://instagram.com/p/demo-${randomUUID().slice(0, 8)}` : "", metrics: ci.metrics },
    });
  }

  // ─── Brand Profile ────────────────────────────────────────────────────────
  const existingBrand = await prisma.brandProfile.findUnique({ where: { propertyId: prop1.id } });
  if (!existingBrand) {
    await prisma.brandProfile.create({
      data: { propertyId: prop1.id, identity: "فندق بوليفار الرياض — وجهة الضيافة الفاخرة في قلب العاصمة. نجمع بين الأصالة السعودية والتصميم العصري.", services: ["إقامة فاخرة", "مطعم النخبة", "سبا بوليفار", "مسبح لا نهائي", "قاعات مؤتمرات", "كونسيرج 24/7"], offers: ["عرض عائلي نهاية الأسبوع", "باقة شهر العسل", "تخفيض 15٪ للحجز المباشر"], audience: "رجال أعمال، عائلات سعودية، سياح خليجيون وأجانب", tone: "دافئ، فاخر، احترافي", language: "both" },
    });
  }

  // ─── Knowledge Base ──────────────────────────────────────────────────────
  const kbItems = [
    { title: "سياسة الإلغاء والتعديل", ar: "يحق للنزيل الإلغاء مجاناً قبل 48 ساعة من الوصول. بعد ذلك تُستقطع رسوم ليلة واحدة.", en: "Free cancellation up to 48 hours before arrival. After that, one night is charged.", tags: ["إلغاء", "cancellation", "policy"] },
    { title: "مواعيد الوجبات والمطاعم", ar: "الإفطار: 7:00-10:30 ص | الغداء: 12:30-3:30 م | العشاء: 7:00-11:00 م. خدمة الغرف متاحة 24/7.", en: "Breakfast: 7-10:30 AM | Lunch: 12:30-3:30 PM | Dinner: 7-11 PM. Room service 24/7.", tags: ["مطعم", "إفطار", "restaurant", "dining"] },
    { title: "مرافق اللياقة البدنية والسبا", ar: "المسبح: 7 ص-10 م. الجيم: 24 ساعة. السبا: 9 ص-9 م.", en: "Pool: 7 AM-10 PM. Gym: 24 hours. Spa: 9 AM-9 PM. Advance bookings recommended.", tags: ["مسبح", "سبا", "جيم", "pool", "spa"] },
    { title: "خدمات النقل والمواصلات", ar: "سيارة فاخرة من/إلى المطار. المطار الدولي: 120 ريال. الحجز عبر خدمة الكونسيرج.", en: "Luxury airport transfers. International airport: SAR 120. Book through concierge.", tags: ["نقل", "مطار", "airport", "transfer"] },
    { title: "شبكة واي فاي", ar: "واي فاي مجاني. الشبكة: Boulevard-Guest | كلمة المرور: Welcome2025. السرعة: 200 Mbps.", en: "Free WiFi. Network: Boulevard-Guest | Password: Welcome2025. Speed: 200 Mbps.", tags: ["واي فاي", "wifi", "internet"] },
    { title: "خدمات الأعمال وقاعات الاجتماعات", ar: "4 قاعات اجتماعات بطاقات 10-200 شخص. للحجز: داخلي 1500.", en: "4 meeting rooms (10-200 pax). Full AV. Book: ext. 1500.", tags: ["مؤتمرات", "meetings", "business"] },
    { title: "خدمة الغسيل والكي", ar: "متاحة 8 ص-8 م. خدمة سريعة (4 ساعات) بإضافة 50٪. للطلب: داخلي 1200.", en: "Available 8 AM-8 PM. Express 4-hour service +50%. Order: ext. 1200.", tags: ["غسيل", "laundry", "pressing"] },
    { title: "سياسة التدخين", ar: "الفندق خالٍ من التدخين بالكامل. غرامة 500 ريال عند التدخين داخل الغرف.", en: "The hotel is entirely non-smoking. SAR 500 fine applies for smoking in rooms.", tags: ["تدخين", "smoking", "policy"] },
  ];

  for (const ki of kbItems) {
    const existing = await prisma.knowledgeItem.findFirst({ where: { propertyId: prop1.id, title: ki.title } });
    if (existing) continue;
    await prisma.knowledgeItem.create({
      data: { propertyId: prop1.id, title: ki.title, contentAr: ki.ar, contentEn: ki.en, tags: ki.tags, status: "approved", approvedBy: staff1["reem"] },
    });
  }

  // ─── Agent Runs ──────────────────────────────────────────────────────────
  const agentRuns = [
    { key: "reception", type: "booking.extend_stay", policy: "queued_for_review", ms: 1240, db: 0.17 },
    { key: "housekeeping", type: "housekeeping.clean_room", policy: "enabled", ms: 830, db: 0.21 },
    { key: "maintenance", type: "maintenance.hvac", policy: "enabled", ms: 950, db: 0.13 },
    { key: "guest_service", type: "dining.add_breakfast", policy: "enabled", ms: 710, db: 0.5 },
    { key: "reception", type: "booking.late_checkout", policy: "queued_for_review", ms: 1380, db: 0.042 },
    { key: "housekeeping", type: "housekeeping.extra_amenities", policy: "enabled", ms: 620, db: 0.33 },
    { key: "maintenance", type: "maintenance.plumbing", policy: "enabled", ms: 880, db: 0.042 },
    { key: "guest_service", type: "transport.arrange_transfer", policy: "queued_for_review", ms: 1520, db: 0.083 },
    { key: "guest_service", type: "feedback.positive", policy: "enabled", ms: 540, db: 1 },
    { key: "maintenance", type: "maintenance.electrical", policy: "enabled", ms: 910, db: 0.42 },
    { key: "housekeeping", type: "housekeeping.escalation", policy: "queued_for_review", ms: 1750, db: 0.083 },
    { key: "reception", type: "booking.extend_stay", policy: "enabled", ms: 1190, db: 2 },
  ];

  for (const ar of agentRuns) {
    const existing = await prisma.agentRun.findFirst({ where: { propertyId: prop1.id, agentKey: ar.key, createdAt: { gte: daysAgo(ar.db + 0.02) } } });
    if (existing) continue;
    await prisma.agentRun.create({
      data: { propertyId: prop1.id, agentKey: ar.key, intentType: ar.type, inputs: { language: "ar" }, outputs: { confidence: 0.94 }, tools: ["pms_lookup", "knowledge_base"], policyApplied: ar.policy, durationMs: ar.ms, createdAt: daysAgo(ar.db) },
    });
  }

  // ─── AltaEvents (live feed) ──────────────────────────────────────────────
  const events = [
    { type: "message.received", payload: { guestName: "أحمد العمري", room: "412", text: "أريد تمديد إقامتي يومين" }, db: 0.17 },
    { type: "intent.extracted", payload: { type: "booking.extend_stay", confidence: 0.96, sentiment: "positive" }, db: 0.17 },
    { type: "review.queued", payload: { department: "reception", guestName: "أحمد العمري" }, db: 0.17 },
    { type: "message.received", payload: { guestName: "فيصل الحربي", room: "101", text: "الغرفة لم تُنظَّف منذ يومين!" }, db: 0.083 },
    { type: "ticket.created", payload: { department: "housekeeping", summary: "شكوى عدم تنظيف الغرفة 101", urgency: "high" }, db: 0.083 },
    { type: "ticket.escalated", payload: { department: "housekeeping", room: "101", reason: "SLA exceeded" }, db: 0.021 },
    { type: "message.received", payload: { guestName: "Lena Wagner", room: "701", text: "Can I get a late checkout?" }, db: 0.042 },
    { type: "review.decided", payload: { department: "reception", decision: "approved", reviewedBy: "فهد الشمري" }, db: 1 },
    { type: "agent.completed", payload: { agentKey: "housekeeping", intentType: "housekeeping.clean_room", durationMs: 830 }, db: 0.21 },
    { type: "agent.completed", payload: { agentKey: "maintenance", intentType: "maintenance.hvac", durationMs: 950 }, db: 0.13 },
  ];

  for (const ev of events) {
    const existing = await prisma.altaEvent.findFirst({ where: { propertyId: prop1.id, type: ev.type, createdAt: { gte: daysAgo(ev.db + 0.01) } } });
    if (existing) continue;
    await prisma.altaEvent.create({ data: { propertyId: prop1.id, type: ev.type, payload: JSON.stringify(ev.payload), createdAt: daysAgo(ev.db) } });
  }

  // ─── Audit Events ─────────────────────────────────────────────────────────
  const auditDefs = [
    { actorName: "فهد الشمري", action: "auth.login", rt: "StaffMember", outcome: "success", meta: {} },
    { actorName: "ريم الغامدي", action: "review.approve", rt: "ReviewItem", outcome: "success", meta: { decision: "approved", department: "reception" } },
    { actorName: "نورة العتيبي", action: "ticket.status_change", rt: "Ticket", outcome: "success", meta: { from: "open", to: "done" } },
    { actorName: "طارق البقمي", action: "workorder.update", rt: "WorkOrder", outcome: "success", meta: { status: "in_progress" } },
    { actorName: "دانة الزهراني", action: "content.approve", rt: "ContentItem", outcome: "success", meta: { channel: "instagram" } },
    { actorName: "ريم الغامدي", action: "review.reject", rt: "ReviewItem", outcome: "success", meta: { reason: "النص يحتاج تعديل" } },
    { actorName: "System", action: "ticket.escalated", rt: "Ticket", outcome: "success", meta: { reason: "SLA exceeded" } },
    { actorName: "وليد السبيعي", action: "auth.login", rt: "StaffMember", outcome: "success", meta: {} },
  ] as const;

  // Through recordAudit(), never a raw insert: the chain hash covers seq,
  // createdAt and every other field, so a hand-rolled hash writes rows that
  // /audit/verify correctly reports as ALTERED — the demo would disprove the
  // tamper-evidence claim it exists to show. The cost is that these entries
  // carry their real insert time instead of a backdated one; an intact chain
  // is worth more on that screen than a spread of dates.
  // Re-running the seeder must not stack another eight identical entries on
  // the trail; one marker row is enough to tell that this block already ran.
  const alreadySeeded = await prisma.auditEvent.findFirst({
    where: { propertyId: prop1.id, metadata: { contains: '"seeded":"demo"' } },
  });
  for (const ae of alreadySeeded ? [] : auditDefs) {
    await recordAudit({
      propertyId: prop1.id,
      actorId: ae.actorName === "System" ? undefined : staff1["fahad"],
      actorName: ae.actorName,
      action: ae.action,
      resourceType: ae.rt,
      outcome: ae.outcome,
      metadata: { ...ae.meta, seeded: "demo" },
      ip: ae.actorName !== "System" ? "192.168.1.10" : undefined,
      userAgent: ae.actorName !== "System" ? "Mozilla/5.0 (Dashboard)" : undefined,
    });
  }

  // ─── Legacy Reviews ───────────────────────────────────────────────────────
  const legacyReviews = [
    { source: "google", rating: 5, text: "فندق استثنائي، خدمة ممتازة وموظفون محترفون." },
    { source: "booking", rating: 4, text: "إقامة رائعة. النظافة ممتازة والموقع مثالي." },
    { source: "tripadvisor", rating: 5, text: "أفضل فندق في الرياض بدون منازع!" },
    { source: "google", rating: 3, text: "الغرفة جيدة لكن التكييف واجه مشكلة." },
    { source: "google", rating: 5, text: "Excellent stay! Staff very friendly and helpful." },
  ];
  for (let i = 0; i < legacyReviews.length; i++) {
    const lr = legacyReviews[i];
    const exists = await prisma.review.findFirst({ where: { propertyId: prop1.id, text: lr.text } });
    if (exists) continue;
    await prisma.review.create({ data: { propertyId: prop1.id, source: lr.source, rating: lr.rating, text: lr.text, createdAt: daysAgo(i * 2 + 1) } });
  }

  console.log("\n✅ Demo seed complete! All sections populated:");
  console.log("   • 8 guests + reservations (prop1) + 1 (prop2)");
  console.log("   • 11 conversations + messages + intents");
  console.log("   • 11 tickets (housekeeping/maintenance/reception/guest_service)");
  console.log("   • 4 pending review items in Review Queue");
  console.log("   • 5 work orders (hvac/plumbing/electrical/furniture)");
  console.log("   • 6 Google reviews with AI-drafted replies");
  console.log("   • 3 complaint cases with full RCA");
  console.log("   • 5 social channels (instagram/tiktok/facebook/x/linkedin)");
  console.log("   • 6 content studio posts");
  console.log("   • 1 brand profile");
  console.log("   • 8 knowledge base articles");
  console.log("   • 12 agent run records");
  console.log("   • 10 live feed events");
  console.log("   • 8 audit trail entries");
  console.log("   • 5 legacy reviews");
  console.log("\n🌐 Open http://localhost:8098");
  console.log("   Login: fahad / alta-demo-2026  (Riyadh property)");
  console.log("   Login: dana  / alta-demo-2026  (Marketing view)");
  console.log("   Login: reem  / alta-demo-2026  (Manager view)");
  console.log("   Login: waleed/ alta-demo-2026  (GM / Executive Report)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
