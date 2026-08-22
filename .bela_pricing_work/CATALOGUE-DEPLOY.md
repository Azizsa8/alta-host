# كتالوج المنتجات — النشر

## الرابط المباشر (يعمل الآن)
https://thunderous-daffodil-774d16.netlify.app

كلمة مرور Netlify المؤقتة:  My-Drop-Site
(تُزال بعد المطالبة بالموقع — الخطوة أدناه)

## مهم: طالِب بالموقع خلال 60 دقيقة وإلا حُذف
https://app.netlify.com/drop/thunderous-daffodil-774d16#drop_token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODcyMjYwNDgsImV4cCI6MTc4NzIyOTY0OCwiaXNzIjoiTmV0bGlmeSIsInNlc3Npb25faWQiOiI1MDBmY2E4YS0wNTk4LTQ5MjItYWFjYi05YjljNDdmNDEzNDQifQ.hY6xhD8vPzJP1mVgSGSc-6g1QwRwnvyghQTNAWD6pfs

بعد المطالبة:
  Site settings → Access & security → Visitor access → أزل كلمة مرور الموقع
عندها يصبح الرابط مفتوحًا لمن تشاركه معه فقط (غير مفهرس في محركات البحث).

## لماذا لم يُنشر على حسابك مباشرة
حساب Netlify (HEADSUP / abdalazizsa57) يمنع النشر حاليًا:
  HTTP 403 — "Account credit usage exceeded - new deploys are blocked until credits are added"
لذلك تم النشر بشكل مجهول (لا يستهلك رصيد الحساب).

## الموقع الجاهز باسم نظيف (بانتظار الرصيد)
أنشأتُ لك مسبقًا:  https://bela-catalogue.netlify.app
ID: 57d9a649-cb03-45c1-bb14-67ea165abf83
بمجرد إضافة رصيد/تجديد الحصة، انشر عليه:

    cd .bela_pricing_work/catalogue_site
    npx netlify deploy --dir=. --prod --site 57d9a649-cb03-45c1-bb14-67ea165abf83

## إعادة البناء بعد أي تعديل
    cd .bela_pricing_work
    uv run python build_catalogue.py
    cp BELA-Catalogue.html catalogue_site/index.html
    # ثم انشر بالأمر أعلاه

## ملاحظات
- الكتالوج بدون كميات وبدون أسعار (تم التحقق).
- الموقع مضبوط noindex + robots disallow → لا يظهر في نتائج البحث.
- تصدير Excel ينتج ملف .xlsx كامل عند فتح الرابط مباشرة.
