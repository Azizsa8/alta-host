# دليل التشغيل — ALTA HOST (§14-5)

كل العمليات أدناه تتم عبر الواجهة أو الـ API الموثّق في `/api/docs`.

## إنشاء فندق جديد (§13)
1. أنشئ سجل `Property` (حاليًا عبر seed أو SQL؛ شاشة alta_admin على خارطة الطريق):
   `INSERT INTO "Property" (id, name) VALUES ('hotel-slug', 'اسم الفندق');`
   — إنشاء الـ Property يزرع تلقائيًا Tenant باسم `tnt-hotel-slug` (خطة تجريبية، 10GB) عبر مشغّل قاعدة البيانات.
2. أنشئ حساب مدير الفندق: صف `StaffMember` بدور `hotel_manager` مع `username` و`passwordHash` (bcrypt).
3. سجّل الدخول كمدير — كل ما يلي يتم من الواجهة.

## ربط واتساب
- **وضع التجربة:** بدون أي إعداد — المحاكي يمر بكامل الخط.
- **إنتاج (WhatsApp Cloud API):** من شاشة بيانات الاعتماد خزّن
  `whatsapp.cloudApiToken` و `whatsapp.phoneNumberId` (تُخزَّن مشفّرة AES-256-GCM، لا تُعرض أبدًا).
  ثم وجّه Webhook ميتا إلى `POST /webhook/whatsapp`.

## ربط Google (التقييمات)
- تجريبي: زر «ربط حساب تجريبي» في شاشة السمعة الرقمية (accountRef يبدأ بـ `mock:`).
- إنتاج: `POST /api/reputation/link` مع `accountRef` (مسار الموقع في GBP) و`oauthRefreshToken`
  — التوكن يذهب للخزنة، ويتطلب `GOOGLE_OAUTH_CLIENT_ID/SECRET` في البيئة.

## ربط الشبكات الاجتماعية (النشر)
- تجريبي: `SOCIAL_PUBLISHER=mock` (الافتراضي) — روابط نشر وهمية مستقرة.
- إنتاج: خزّن `meta.pageToken` و `meta.pageId` في الخزنة واضبط `SOCIAL_PUBLISHER=meta`.
- تيك توك يبقى draft-mode (§8) حتى يتوفر مسار API.

## إدارة التخزين والمستخدمين
- الحصة لكل فندق في `Tenant.quotaGb`؛ التنبيه عند 80% تلقائي، والرفض عند 100% (507).
- سلة المحذوفات 30 يومًا ثم حذف نهائي (مكنسة كل ساعة).
- إضافة موظف: صف `StaffMember` بالدور المناسب (§3) — الأدوار في
  `apps/api/src/modules/auth/permissions.ts` وهي الجدول الوحيد للصلاحيات.

## عمليات يومية
- تعطّل وكيل؟ مركز الوكلاء → إيقاف — الرسائل تتحول للموظفين فورًا.
- استلام محادثة من AI: صندوق الرسائل → «استلام المحادثة»؛ الإرجاع للـ AI قرار مدير.
- التحقق من سلامة سجل التدقيق: `GET /api/audit/verify` — يجب `valid: true` دائمًا.
