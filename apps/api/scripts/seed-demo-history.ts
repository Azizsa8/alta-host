/**
 * Populates a demo property with believable OPERATING HISTORY — the last
 * three weeks of a hotel that has actually been using ALTA HOST.
 *
 * Why this exists: an empty platform demos badly. Every screen shows a
 * zero, the KPIs read "لا بيانات بعد", and the story ("here is where the
 * agent caught the complaint") has nothing to point at. This seeds the
 * evidence a real month leaves behind.
 *
 * Two rules it follows:
 *   1. Timestamps are SPREAD across real past days, because the KPIs are
 *      computed from them. A median first-response time is meaningless if
 *      every message shares one timestamp.
 *   2. Audit entries go through recordAudit(), never a raw insert, so the
 *      tamper-evident chain still verifies after seeding. A demo that
 *      breaks /audit/verify would undercut the exact claim it's showing.
 *
 * Usage: npm run db:demo-history --workspace apps/api [propertyId]
 */
import { PrismaClient } from "@prisma/client";
import { recordAudit } from "../src/modules/audit/service.js";

const prisma = new PrismaClient();
const PROPERTY = process.argv[2] ?? "demo-property";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();
/** `d` days ago at hour `h` — keeps the history readable in the UI. */
const ago = (d: number, h = 10, m = 0) => new Date(now - d * DAY + (h - 12) * HOUR + m * 60000);

async function main() {
  const property = await prisma.property.findUnique({ where: { id: PROPERTY } });
  if (!property) {
    console.error(`Property "${PROPERTY}" not found — run db:seed first.`);
    process.exit(1);
  }
  const staff = await prisma.staffMember.findMany({ where: { propertyId: PROPERTY } });
  const by = (role: string) => staff.find((s) => s.role === role) ?? staff[0];
  const manager = by("hotel_manager");
  const tech = by("technician");
  const marketing = by("marketing_manager");
  const housekeeper = staff.find((s) => s.department === "housekeeping") ?? staff[0];

  console.log(`Seeding demo history for ${PROPERTY}…`);

  /* ─── 1. Guests and the conversations they actually had ───────────── */

  const GUESTS: Array<{
    name: string;
    phone: string;
    room: string;
    thread: Array<{ dir: "inbound" | "outbound"; text: string; day: number; hour: number; min?: number }>;
  }> = [
    {
      name: "عبدالله السالم",
      phone: "966501112201",
      room: "412",
      thread: [
        { dir: "inbound", text: "مساء الخير، ممكن تجهزون الغرفة بسرير إضافي؟", day: 18, hour: 15 },
        { dir: "outbound", text: "أبشر أستاذ عبدالله — سجّلنا الطلب وفريق التدبير المنزلي يجهّزه قبل وصولك.", day: 18, hour: 15, min: 1 },
        { dir: "inbound", text: "شكرًا، وكم الساعة الفطور؟", day: 18, hour: 15, min: 6 },
        { dir: "outbound", text: "الفطور يوميًا من ٦:٣٠ إلى ١٠:٣٠ صباحًا في مطعم البستان.", day: 18, hour: 15, min: 7 },
      ],
    },
    {
      name: "نورة القحطاني",
      phone: "966501112202",
      room: "215",
      thread: [
        { dir: "inbound", text: "المكيف ما يبرد في الغرفة", day: 12, hour: 22 },
        { dir: "outbound", text: "أسفين على الإزعاج — أنشأنا بلاغ صيانة عاجل والفني في طريقه إليك الآن.", day: 12, hour: 22, min: 1 },
        { dir: "inbound", text: "تمام وصل وصلحه، شكرًا لسرعتكم", day: 12, hour: 23, min: 10 },
        { dir: "outbound", text: "سعدنا بخدمتك، وأي شيء آخر نحن معك. 🌟", day: 12, hour: 23, min: 11 },
      ],
    },
    {
      name: "James Miller",
      phone: "447700900303",
      room: "508",
      thread: [
        { dir: "inbound", text: "Can I have a late checkout until 2pm tomorrow?", day: 9, hour: 19 },
        { dir: "outbound", text: "Approved — your checkout is now 2:00 PM. Enjoy the extra time.", day: 9, hour: 19, min: 12 },
      ],
    },
    {
      name: "منى الحربي",
      phone: "966501112204",
      room: "309",
      thread: [
        { dir: "inbound", text: "الغرفة ما كانت نظيفة عند الوصول والخدمة سيئة، بكتب تقييم", day: 6, hour: 21 },
        { dir: "outbound", text: "وصلتنا رسالتك ✅ أحد أفراد الفريق يراجعها الآن ويردّ عليك خلال لحظات.", day: 6, hour: 21, min: 1 },
        { dir: "outbound", text: "أعتذر بصدق أ. منى — جهّزنا لك غرفة بديلة الآن، ومدير الفندق يتابع الموضوع شخصيًا.", day: 6, hour: 21, min: 9 },
        { dir: "inbound", text: "أقدّر تجاوبكم، الغرفة الجديدة ممتازة", day: 6, hour: 22, min: 5 },
      ],
    },
    {
      name: "خالد العتيبي",
      phone: "966501112205",
      room: "104",
      thread: [
        { dir: "inbound", text: "في ضجيج من الغرفة المجاورة ما أقدر أنام", day: 4, hour: 1 },
        { dir: "outbound", text: "نعتذر — نقلناك لغرفة هادئة في الدور السادس، والمفتاح جاهز في الاستقبال.", day: 4, hour: 1, min: 8 },
      ],
    },
    {
      name: "سارة الدوسري",
      phone: "966501112206",
      room: "622",
      thread: [
        { dir: "inbound", text: "ابي تنظيف الغرفة لو سمحتوا", day: 2, hour: 11 },
        { dir: "outbound", text: "تمام، فريق التنظيف بالطريق إلى غرفتك.", day: 2, hour: 11, min: 1 },
      ],
    },
    {
      name: "فيصل الشهري",
      phone: "966501112207",
      room: "731",
      thread: [
        { dir: "inbound", text: "الفاتورة فيها رسوم ما فهمتها", day: 1, hour: 17 },
        { dir: "outbound", text: "وصلتنا رسالتك ✅ أحد أفراد الفريق يراجعها الآن ويردّ عليك خلال لحظات.", day: 1, hour: 17, min: 1 },
      ],
    },
  ];

  const guestIds: Record<string, string> = {};
  const convIds: Record<string, string> = {};

  for (const g of GUESTS) {
    const guest = await prisma.guest.upsert({
      where: { whatsappId: g.phone },
      update: {},
      create: {
        propertyId: PROPERTY,
        whatsappId: g.phone,
        name: g.name,
        preferredDialect: g.phone.startsWith("9665") ? "saudi" : "english",
        createdAt: ago(20),
      },
    });
    guestIds[g.phone] = guest.id;

    const conv = await prisma.conversation.create({
      data: { guestId: guest.id, channel: "whatsapp", createdAt: ago(20) },
    });
    convIds[g.phone] = conv.id;

    await prisma.reservation.create({
      data: {
        guestId: guest.id,
        propertyId: PROPERTY,
        roomNumber: g.room,
        checkIn: ago(g.thread[0].day + 1),
        checkOut: ago(g.thread[0].day - 2),
        status: "confirmed",
      },
    });

    for (const m of g.thread) {
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: m.dir,
          rawText: m.text,
          mediaType: "text",
          createdAt: ago(m.day, m.hour, m.min ?? 0),
        },
      });
    }
  }
  console.log(`  ✓ ${GUESTS.length} guests with real conversation threads`);

  /* ─── 2. Intents, tickets and the review queue behind them ────────── */

  async function intentFor(phone: string, type: string, day: number, hour: number, sentiment: string, urgency: string) {
    const msg = await prisma.message.findFirst({
      where: { conversationId: convIds[phone], direction: "inbound" },
      orderBy: { createdAt: "asc" },
    });
    return prisma.intent.create({
      data: {
        messageId: msg!.id,
        type,
        params: JSON.stringify({ description: msg!.rawText }),
        confidence: 0.82,
        sentiment,
        urgency,
        createdAt: ago(day, hour),
      },
    });
  }

  const iClean = await intentFor("966501112206", "housekeeping.clean_room", 2, 11, "neutral", "normal");
  const iAc = await intentFor("966501112202", "maintenance.report_issue", 12, 22, "negative", "urgent");
  const iLate = await intentFor("447700900303", "booking.extend_stay", 9, 19, "neutral", "normal");
  const iDirty = await intentFor("966501112204", "guest_service.complaint", 6, 21, "negative", "urgent");
  const iNoise = await intentFor("966501112205", "guest_service.complaint", 4, 1, "negative", "urgent");
  const iBill = await intentFor("966501112207", "guest_service.complaint", 1, 17, "negative", "normal");

  const tickets = [
    { intent: iClean, dept: "housekeeping", status: "done", summary: "طلب تنظيف غرفة ٦٢٢", day: 2, hour: 11, sla: 2, escalated: false, staff: housekeeper },
    { intent: iAc, dept: "maintenance", status: "done", summary: "مكيف لا يبرد — غرفة ٢١٥", day: 12, hour: 22, sla: 0.5, escalated: false, staff: tech },
    { intent: iDirty, dept: "guest_service", status: "done", summary: "شكوى نظافة — غرفة ٣٠٩", day: 6, hour: 21, sla: 1, escalated: false, staff: manager },
    { intent: iNoise, dept: "guest_service", status: "done", summary: "شكوى ضجيج — غرفة ١٠٤", day: 4, hour: 1, sla: 0.5, escalated: false, staff: manager },
    { intent: iBill, dept: "reception", status: "open", summary: "اعتراض على بند في الفاتورة — غرفة ٧٣١", day: 1, hour: 17, sla: 1, escalated: true, staff: manager },
  ];
  for (const t of tickets) {
    await prisma.ticket.create({
      data: {
        intentId: t.intent.id,
        department: t.dept,
        status: t.status,
        assignedStaffId: t.staff?.id,
        summary: t.summary,
        slaDeadline: new Date(ago(t.day, t.hour).getTime() + t.sla * HOUR),
        escalatedAt: t.escalated ? new Date(ago(t.day, t.hour).getTime() + t.sla * HOUR + 10 * 60000) : null,
        createdAt: ago(t.day, t.hour),
      },
    });
  }
  console.log(`  ✓ ${tickets.length} tickets (4 closed within SLA, 1 open and escalated)`);

  // Review queue: two decided, one still waiting so the demo has something
  // to approve live.
  await prisma.reviewItem.create({
    data: {
      intentId: iLate.id,
      department: "reception",
      draftReply: "Approved — your checkout is now 2:00 PM. Enjoy the extra time.",
      pendingAction: JSON.stringify({ type: "extend_checkout", params: { hours: 2 } }),
      status: "approved",
      reviewedBy: manager?.name ?? "Reem",
      createdAt: ago(9, 19),
      reviewedAt: ago(9, 19, 11),
    },
  });
  await prisma.reviewItem.create({
    data: {
      intentId: iDirty.id,
      department: "guest_service",
      draftReply: "أعتذر بصدق أ. منى — جهّزنا لك غرفة بديلة الآن، ومدير الفندق يتابع الموضوع شخصيًا.",
      pendingAction: JSON.stringify({ type: "log_complaint", params: {} }),
      status: "approved",
      reviewedBy: manager?.name ?? "Reem",
      createdAt: ago(6, 21),
      reviewedAt: ago(6, 21, 8),
    },
  });
  await prisma.reviewItem.create({
    data: {
      intentId: iBill.id,
      department: "guest_service",
      draftReply: "أستاذ فيصل، راجعنا الفاتورة والبند يخص خدمة الغرف ليلة ٢٢. نرفق لك التفصيل، وإن كان هناك خطأ نصححه فورًا.",
      pendingAction: JSON.stringify({ type: "log_complaint", params: {} }),
      status: "pending",
      createdAt: ago(1, 17),
    },
  });
  console.log("  ✓ review queue: 2 decided, 1 waiting for the demo");

  /* ─── 3. Work orders, including the manager-gated critical close ──── */

  const wo1 = await prisma.workOrder.create({
    data: {
      propertyId: PROPERTY,
      title: "مكيف لا يبرد — غرفة ٢١٥",
      category: "hvac",
      priority: "high",
      status: "closed",
      assigneeId: tech?.id,
      location: "غرفة ٢١٥",
      createdBy: manager?.id ?? "system",
      closedBy: tech?.id,
      closedAt: ago(12, 23),
      createdAt: ago(12, 22),
      checklist: [
        { item: "فحص الفلتر", done: true },
        { item: "قياس غاز التبريد", done: true },
      ],
    },
  });
  await prisma.workOrderUpdate.createMany({
    data: [
      { workOrderId: wo1.id, authorId: tech?.id ?? "t", authorName: tech?.name ?? "Tariq", note: "وصلت للغرفة، الفلتر مسدود", statusTo: "in_progress", createdAt: ago(12, 22, 20) },
      { workOrderId: wo1.id, authorId: tech?.id ?? "t", authorName: tech?.name ?? "Tariq", note: "نُظّف الفلتر وأُعيد التشغيل — يبرد الآن", statusTo: "closed", createdAt: ago(12, 23) },
    ],
  });

  const wo2 = await prisma.workOrder.create({
    data: {
      propertyId: PROPERTY,
      title: "تسريب مياه تحت مغسلة الدور الثالث",
      category: "plumbing",
      priority: "critical",
      status: "awaiting_confirm",
      assigneeId: tech?.id,
      location: "الدور الثالث — الممر",
      createdBy: manager?.id ?? "system",
      createdAt: ago(1, 9),
      checklist: [
        { item: "إغلاق محبس المياه", done: true },
        { item: "استبدال الوصلة", done: true },
        { item: "فحص الأرضية للرطوبة", done: false },
      ],
    },
  });
  await prisma.workOrderUpdate.createMany({
    data: [
      { workOrderId: wo2.id, authorId: tech?.id ?? "t", authorName: tech?.name ?? "Tariq", note: "أغلقت المحبس وبدأت الاستبدال", statusTo: "in_progress", createdAt: ago(1, 9, 25) },
      { workOrderId: wo2.id, authorId: tech?.id ?? "t", authorName: tech?.name ?? "Tariq", note: "تم الإصلاح — بانتظار تأكيد مدير الصيانة للإغلاق", statusTo: "awaiting_confirm", createdAt: ago(1, 10, 40) },
    ],
  });

  await prisma.workOrder.create({
    data: {
      propertyId: PROPERTY,
      title: "مصباح ممر الدور الخامس لا يعمل",
      category: "electrical",
      priority: "low",
      status: "assigned",
      assigneeId: tech?.id,
      location: "الدور الخامس",
      createdBy: manager?.id ?? "system",
      createdAt: ago(0, 8),
    },
  });
  console.log("  ✓ 3 work orders (1 closed, 1 critical awaiting manager confirm, 1 new)");

  /* ─── 4. Google reviews, some already answered ────────────────────── */

  await prisma.socialAccount.upsert({
    where: { propertyId_platform: { propertyId: PROPERTY, platform: "google" } },
    update: {},
    create: { propertyId: PROPERTY, platform: "google", accountRef: `mock:${PROPERTY}` },
  });

  const REVIEWS = [
    { id: "d1", stars: 5, author: "عبدالله السالم", text: "فندق رائع والاستقبال محترف جدًا، الغرف نظيفة والإفطار ممتاز.", sentiment: "positive", topic: "staff", day: 17, replied: true, reply: "شكرًا جزيلًا عبدالله على تقييمك الجميل! سعدنا باستضافتك ونتطلع لرؤيتك مرة أخرى قريبًا." },
    { id: "d2", stars: 4, author: "James Miller", text: "Great location and friendly staff. Breakfast could have more variety.", sentiment: "positive", topic: "food", day: 14, replied: true, reply: "Thank you, James! We're glad you enjoyed your stay — we've added new items to the breakfast selection." },
    { id: "d3", stars: 2, author: "منى الحربي", text: "النظافة سيئة والغرفة ما كانت جاهزة عند الوصول.", sentiment: "negative", topic: "cleanliness", day: 6, replied: true, reply: "نعتذر بصدق أ. منى — عالجنا الأمر فورًا وراجعنا إجراءات تجهيز الغرف بالكامل." },
    { id: "d4", stars: 5, author: "سارة الدوسري", text: "خدمة الواتساب سريعة جدًا، طلبت تنظيف ووصلوا خلال دقائق.", sentiment: "positive", topic: "staff", day: 2, replied: false, reply: "" },
    { id: "d5", stars: 3, author: "فيصل الشهري", text: "الموقع ممتاز لكن عندي ملاحظة على وضوح بنود الفاتورة.", sentiment: "neutral", topic: "value", day: 1, replied: false, reply: "" },
  ];
  for (const r of REVIEWS) {
    await prisma.googleReview.upsert({
      where: { propertyId_externalId: { propertyId: PROPERTY, externalId: `demo-${r.id}` } },
      update: {},
      create: {
        propertyId: PROPERTY,
        externalId: `demo-${r.id}`,
        stars: r.stars,
        text: r.text,
        author: r.author,
        reviewedAt: ago(r.day, 12),
        sentiment: r.sentiment,
        topic: r.topic,
        draftReply: r.replied ? r.reply : "شكرًا على ملاحظاتك — نقدّر وقتك وسنعمل على التحسين المستمر.",
        replyStatus: r.replied ? "published" : "draft",
        approvedBy: r.replied ? marketing?.id : null,
        publishedAt: r.replied ? ago(r.day, 14) : null,
        createdAt: ago(r.day, 12),
      },
    });
  }
  console.log(`  ✓ ${REVIEWS.length} Google reviews (3 answered, 2 waiting — avg 3.8★)`);

  /* ─── 5. Social channels: connected, with real cadence + analytics ── */

  const CHANNELS = [
    { key: "instagram", handle: "@alta_riyadh", perWeek: 5, times: ["19:00", "21:30"], followers: 12840, reach: 48200, eng: 3960, tone: "بصري ودافئ" },
    { key: "x", handle: "@alta_ksa", perWeek: 12, times: ["08:00", "13:00"], followers: 5310, reach: 21400, eng: 1180, tone: "خبري مختصر" },
    { key: "tiktok", handle: "@altahost", perWeek: 3, times: ["20:00"], followers: 9120, reach: 63500, eng: 7400, tone: "شبابي وسريع" },
    { key: "linkedin", handle: "alta-host", perWeek: 2, times: ["09:00"], followers: 1870, reach: 6300, eng: 410, tone: "مهني" },
    { key: "google_business", handle: "ALTA Riyadh", perWeek: 2, times: ["10:00"], followers: 0, reach: 15900, eng: 620, tone: "معلوماتي" },
    { key: "snapchat", handle: "altahotel", perWeek: 5, times: ["18:00"], followers: 4400, reach: 18800, eng: 2100, tone: "يومي وقريب" },
  ];
  for (const c of CHANNELS) {
    await prisma.socialChannel.upsert({
      where: { propertyId_channel: { propertyId: PROPERTY, channel: c.key } },
      update: {},
      create: {
        propertyId: PROPERTY,
        channel: c.key,
        handle: c.handle,
        enabled: true,
        // Demo history shows channels as configured and reporting, but NOT
        // "connected" — connection means a real token in the vault, and
        // faking that would have the agent claim it can publish when it
        // cannot. The connect flow stays a live demo step.
        connected: false,
        postsPerWeek: c.perWeek,
        bestTimes: c.times,
        tone: c.tone,
        followers: c.followers,
        reach30d: c.reach,
        engagement30d: c.eng,
        lastSyncedAt: ago(0, 6),
        createdAt: ago(20),
      },
    });
  }
  console.log(`  ✓ ${CHANNELS.length} social channels with 30-day analytics`);

  /* ─── 6. Content pipeline across every stage ──────────────────────── */

  await prisma.brandProfile.upsert({
    where: { propertyId: PROPERTY },
    update: {},
    create: {
      propertyId: PROPERTY,
      identity: "فندق بوتيك في قلب الرياض يجمع الضيافة السعودية بالتصميم الحديث",
      services: ["مسبح خارجي", "سبا", "قاعات اجتماعات", "مطعم البستان"],
      offers: ["عرض نهاية الأسبوع ٢٥٪", "إقامة عائلية مع فطور مجاني"],
      audience: "عائلات سعودية، رجال أعمال، زوار من الخليج",
      language: "both",
    },
  });

  const CONTENT = [
    { idea: "إعلان عرض: عرض نهاية الأسبوع ٢٥٪ — مع دعوة واضحة للحجز المباشر", channel: "instagram", status: "published", day: 8, url: "https://mock.social/instagram/demo/p1" },
    { idea: "تسليط الضوء على المسبح الخارجي بصور حقيقية من الفندق", channel: "instagram", status: "published", day: 5, url: "https://mock.social/instagram/demo/p2" },
    { idea: "خلف الكواليس: فريق الاستقبال يجهّز ليوم كامل", channel: "tiktok", status: "published", day: 3, url: "https://mock.social/tiktok/demo/p3" },
    { idea: "نصيحة سفر محلية: أفضل ٣ أماكن قريبة من الفندق", channel: "x", status: "scheduled", day: -2, url: "" },
    { idea: "قاعات الاجتماعات: مساحة عمل ليوم كامل", channel: "linkedin", status: "in_review", day: 0, url: "" },
    { idea: "قصة نزيل: تجربة إقامة عائلية", channel: "instagram", status: "draft", day: 0, url: "" },
  ];
  for (const c of CONTENT) {
    await prisma.contentItem.create({
      data: {
        propertyId: PROPERTY,
        idea: c.idea,
        channel: c.channel,
        status: c.status,
        bodyAr: `${c.idea}\n\nفي فندق ألتا الرياض — نسعد باستقبالكم.\nللحجز والاستفسار: تواصلوا معنا عبر واتساب. ✨`,
        approvedBy: ["published", "scheduled"].includes(c.status) ? marketing?.id : null,
        scheduledAt: c.status === "scheduled" ? ago(c.day, 20) : null,
        publishedAt: c.status === "published" ? ago(c.day, 20) : null,
        resultUrl: c.url,
        createdAt: ago(Math.max(c.day, 0) + 1, 10),
      },
    });
  }
  console.log(`  ✓ ${CONTENT.length} content items across draft → published`);

  /* ─── 7. Complaint cases with RCA, action plans and a repeat cause ── */

  const CASES = [
    {
      text: "الغرفة ما كانت نظيفة عند الوصول والخدمة سيئة، بكتب تقييم",
      category: "cleanliness",
      severity: "high",
      risk: 75,
      day: 6,
      rootCause: "عدد الغرف المسند لكل موظف تدبير أعلى من الطاقة في مناوبة المساء",
      status: "resolved",
      resolvedDay: 5,
    },
    {
      text: "الغرفة فيها شعر على السرير ورائحة غير مريحة",
      category: "cleanliness",
      severity: "medium",
      risk: 45,
      day: 15,
      rootCause: "عدد الغرف المسند لكل موظف تدبير أعلى من الطاقة في مناوبة المساء",
      status: "resolved",
      resolvedDay: 14,
    },
    {
      text: "في ضجيج من الغرفة المجاورة ما أقدر أنام",
      category: "noise",
      severity: "medium",
      risk: 40,
      day: 4,
      rootCause: "الغرف المجاورة لمخرج السلالم تُسند دون وسم مصدر الضجيج",
      status: "resolved",
      resolvedDay: 3,
    },
    {
      text: "الفاتورة فيها رسوم ما فهمتها وأبي توضيح",
      category: "billing",
      severity: "medium",
      risk: 55,
      day: 1,
      rootCause: "",
      status: "open",
      resolvedDay: null,
    },
  ];

  for (const c of CASES) {
    const whys =
      c.category === "cleanliness"
        ? [
            { question: "لماذا لم تكن الغرفة على مستوى النظافة المطلوب؟", answer: c.rootCause ? "لم يكتمل التجهيز قبل تسليم الغرفة" : "" },
            { question: "لماذا لم يكتشف المشرف ذلك قبل تسليم الغرفة؟", answer: c.rootCause ? "المشرف كان يغطي دورين في نفس المناوبة" : "" },
            { question: "هل كان وقت التجهيز كافيًا لعدد الغرف المسندة؟", answer: c.rootCause ? "لا — ١٨ غرفة لموظف واحد في مناوبة المساء" : "" },
          ]
        : [{ question: "ما الذي حدث بالضبط من وجهة نظر النزيل؟", answer: c.rootCause ? "أُسندت غرفة ملاصقة لمخرج السلالم" : "" }];

    const actions = c.rootCause
      ? [
          { action: "إعادة تجهيز الغرفة وتفتيشها بمشرف قبل التسليم", owner: housekeeper?.name ?? "", dueAt: ago(c.day - 1, 12).toISOString(), done: true },
          { action: "مراجعة عدد الغرف المسندة لكل موظف في المناوبة", owner: manager?.name ?? "", dueAt: ago(c.day - 2, 12).toISOString(), done: true },
          { action: "تفعيل قائمة فحص مصوّرة قبل تسليم أي غرفة", owner: manager?.name ?? "", dueAt: ago(-4, 12).toISOString(), done: false },
        ]
      : [];

    await prisma.complaintCase.create({
      data: {
        propertyId: PROPERTY,
        source: "whatsapp",
        text: c.text,
        category: c.category,
        severity: c.severity,
        reputationRisk: c.risk,
        status: c.status,
        rcaWhy: whys,
        rootCause: c.rootCause,
        contributing: c.rootCause ? ["ذروة وصول", "نقص موظف واحد في المناوبة"] : [],
        actions,
        preventive: c.rootCause ? "قائمة فحص مصوّرة إلزامية قبل تسليم أي غرفة" : "",
        ownerId: manager?.id,
        resolvedAt: c.resolvedDay !== null ? ago(c.resolvedDay, 16) : null,
        resolutionNote: c.resolvedDay !== null ? "نُفّذت الخطة وأُبلغ النزيل" : "",
        createdAt: ago(c.day, 21),
      },
    });
  }
  console.log(`  ✓ ${CASES.length} complaint cases (3 resolved, 1 open, one repeat root cause)`);

  /* ─── 8. Knowledge the agents actually answer from ────────────────── */

  const KNOWLEDGE = [
    { title: "مواعيد الفطور", contentAr: "الفطور يوميًا من ٦:٣٠ إلى ١٠:٣٠ صباحًا في مطعم البستان.", tags: ["فطور", "breakfast", "افطار"] },
    { title: "الواي فاي", contentAr: "شبكة الفندق ALTA-Guest وكلمة المرور مطبوعة على كرت الغرفة.", tags: ["واي فاي", "wifi", "انترنت"] },
    { title: "مواعيد المسبح", contentAr: "المسبح مفتوح يوميًا من ٧ صباحًا حتى ١٠ مساءً.", tags: ["مسبح", "pool", "سباحة"] },
    { title: "وقت الدخول والخروج", contentAr: "الدخول من الساعة ٣ عصرًا، والخروج حتى ١٢ ظهرًا. التمديد متاح حسب التوفر.", tags: ["دخول", "خروج", "checkin", "checkout"] },
    { title: "مواقف السيارات", contentAr: "المواقف مجانية للنزلاء في القبو، والدخول من البوابة الشرقية.", tags: ["مواقف", "parking", "سيارة"] },
  ];
  for (const k of KNOWLEDGE) {
    await prisma.knowledgeItem.create({
      data: {
        propertyId: PROPERTY,
        title: k.title,
        contentAr: k.contentAr,
        tags: k.tags,
        status: "approved",
        approvedBy: manager?.id,
        createdAt: ago(19),
      },
    });
  }
  console.log(`  ✓ ${KNOWLEDGE.length} approved knowledge items`);

  /* ─── 9. Agent runs — these drive the auto-resolution KPI ─────────── */

  const RUNS: Array<[string, string, string, number, number]> = [
    // agentKey, intentType, policyApplied, count, spreadDays
    ["housekeeping", "housekeeping.clean_room", "enabled", 22, 14],
    ["maintenance", "maintenance.report_issue", "enabled", 17, 14],
    ["reception", "reception.faq", "enabled", 31, 14],
    ["reception", "booking.extend_stay", "queued_for_review", 9, 14],
    ["guest_service", "guest_service.complaint", "queued_for_review", 7, 14],
    ["complaint_manager", "complaint.triage", "enabled", 6, 14],
    ["social_media", "social.generate", "enabled", 11, 14],
  ];
  let runTotal = 0;
  for (const [agentKey, intentType, policy, count, spread] of RUNS) {
    for (let i = 0; i < count; i++) {
      await prisma.agentRun.create({
        data: {
          propertyId: PROPERTY,
          agentKey,
          intentType,
          policyApplied: policy,
          durationMs: 60 + Math.round((i * 37) % 240),
          inputs: {},
          outputs: { status: policy === "queued_for_review" ? "queued_for_review" : "sent" },
          createdAt: ago((i % spread) + 1, 9 + (i % 12)),
        },
      });
      runTotal++;
    }
  }
  console.log(`  ✓ ${runTotal} agent runs (~81% auto-resolved)`);

  /* ─── 10. Positive intents so satisfaction isn't a false zero ─────── */

  // Thank-you messages carry sentiment too. Without them the satisfaction
  // KPI reads 0% positive, which is worse than no number — it looks like
  // every guest was unhappy.
  const PRAISE = [
    { phone: "966501112202", text: "تمام وصل وصلحه، شكرًا لسرعتكم", day: 12 },
    { phone: "966501112204", text: "أقدّر تجاوبكم، الغرفة الجديدة ممتازة", day: 6 },
    { phone: "966501112201", text: "شكرًا، الخدمة ممتازة", day: 18 },
  ];
  for (const p of PRAISE) {
    const msg = await prisma.message.findFirst({
      where: { conversationId: convIds[p.phone], direction: "inbound", rawText: { contains: p.text.slice(0, 12) } },
    });
    if (!msg) continue;
    await prisma.intent.create({
      data: {
        messageId: msg.id,
        type: "reception.faq",
        params: JSON.stringify({ question: p.text }),
        confidence: 0.7,
        sentiment: "positive",
        urgency: "normal",
        createdAt: ago(p.day, 12),
      },
    });
  }
  console.log(`  ✓ ${PRAISE.length} positive-sentiment intents`);

  /* ─── 11. Event history so the Ops Center opens with a live log ───── */

  type Evt = { type: string; payload: Record<string, unknown>; day: number; hour: number };
  const EVENTS: Evt[] = [
    { type: "message.received", payload: { conversationId: convIds["966501112202"], guestId: guestIds["966501112202"], mediaType: "text", preview: "المكيف ما يبرد في الغرفة" }, day: 12, hour: 22 },
    { type: "intent.extracted", payload: { messageId: "seed", intents: [{ type: "maintenance.report_issue", confidence: 0.86 }], sentiment: "negative", urgency: "urgent" }, day: 12, hour: 22 },
    { type: "agent.started", payload: { agentKey: "maintenance", intentId: iAc.id, intentType: "maintenance.report_issue" }, day: 12, hour: 22 },
    { type: "ticket.created", payload: { ticketId: "seed", department: "maintenance", urgency: "urgent", summary: "مكيف لا يبرد — غرفة ٢١٥" }, day: 12, hour: 22 },
    { type: "agent.completed", payload: { agentKey: "maintenance", intentId: iAc.id, outcome: "sent", replyPreview: "أنشأنا بلاغ صيانة عاجل" }, day: 12, hour: 22 },
    { type: "message.received", payload: { conversationId: convIds["966501112204"], guestId: guestIds["966501112204"], mediaType: "text", preview: "الغرفة ما كانت نظيفة والخدمة سيئة" }, day: 6, hour: 21 },
    { type: "complaint.captured", payload: { caseId: "seed", category: "cleanliness", severity: "high", reputationRisk: 75 }, day: 6, hour: 21 },
    { type: "complaint.reputation_risk", payload: { caseId: "seed", reputationRisk: 75, signals: ["النزيل لمّح لنشر تقييم علني", "لغة غاضبة"], preview: "الغرفة ما كانت نظيفة والخدمة سيئة" }, day: 6, hour: 21 },
    { type: "review.queued", payload: { reviewItemId: "seed", department: "guest_service", intentId: iDirty.id }, day: 6, hour: 21 },
    { type: "review.decided", payload: { reviewItemId: "seed", decision: "approved", reviewedBy: manager?.name ?? "Reem" }, day: 6, hour: 21 },
    { type: "complaint.status", payload: { caseId: "seed", status: "action_planned" }, day: 6, hour: 22 },
    { type: "complaint.status", payload: { caseId: "seed", status: "resolved" }, day: 5, hour: 16 },
    { type: "review.fetched", payload: { reviewId: "seed", stars: 5, sentiment: "positive", topic: "staff" }, day: 2, hour: 12 },
    { type: "review.replied", payload: { reviewId: "seed", stars: 2 }, day: 6, hour: 14 },
    { type: "content.published", payload: { contentId: "seed", channel: "instagram", resultUrl: "https://mock.social/instagram/demo/p2" }, day: 5, hour: 20 },
    { type: "workorder.critical", payload: { workOrderId: wo2.id, title: "تسريب مياه تحت مغسلة الدور الثالث", location: "الدور الثالث" }, day: 1, hour: 9 },
    { type: "workorder.updated", payload: { workOrderId: wo2.id, status: "awaiting_confirm" }, day: 1, hour: 10 },
    { type: "ticket.escalated", payload: { ticketId: "seed", department: "reception" }, day: 1, hour: 18 },
    { type: "message.received", payload: { conversationId: convIds["966501112206"], guestId: guestIds["966501112206"], mediaType: "text", preview: "ابي تنظيف الغرفة لو سمحتوا" }, day: 2, hour: 11 },
    { type: "ticket.created", payload: { ticketId: "seed", department: "housekeeping", urgency: "normal", summary: "طلب تنظيف غرفة ٦٢٢" }, day: 2, hour: 11 },
  ];
  for (const e of EVENTS) {
    await prisma.altaEvent.create({
      data: {
        propertyId: PROPERTY,
        type: e.type,
        // AltaEvent.payload is a JSON string column, matching emitEvent().
        payload: JSON.stringify({ type: e.type, ...e.payload }),
        createdAt: ago(e.day, e.hour),
      },
    });
  }
  console.log(`  ✓ ${EVENTS.length} events so the Ops Center opens with real history`);

  /* ─── 12. Audit entries through the real chain ────────────────────── */

  const AUDITS: Array<[string, string, string]> = [
    ["review.approve", manager?.name ?? "Reem", "ReviewItem"],
    ["workorder.create", manager?.name ?? "Reem", "WorkOrder"],
    ["workorder.close", tech?.name ?? "Tariq", "WorkOrder"],
    ["complaint.rca_recorded", manager?.name ?? "Reem", "ComplaintCase"],
    ["complaint.resolved", manager?.name ?? "Reem", "ComplaintCase"],
    ["review.reply_published", marketing?.name ?? "Dana", "GoogleReview"],
    ["content.published", marketing?.name ?? "Dana", "ContentItem"],
    ["knowledge.approved", manager?.name ?? "Reem", "KnowledgeItem"],
    ["conversation.takeover", manager?.name ?? "Reem", "Conversation"],
    ["agent.enable", manager?.name ?? "Reem", "AgentPolicy"],
  ];
  for (const [action, actorName, resourceType] of AUDITS) {
    // Through recordAudit so the hash chain stays valid — a demo that
    // breaks /audit/verify would undercut the claim it is demonstrating.
    await recordAudit({
      actorName,
      propertyId: PROPERTY,
      action,
      resourceType,
      outcome: "success",
      metadata: { seeded: "demo history" },
    });
  }
  console.log(`  ✓ ${AUDITS.length} audit entries (chain intact)`);

  console.log("\nDone. The demo now has three weeks of operating history.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
