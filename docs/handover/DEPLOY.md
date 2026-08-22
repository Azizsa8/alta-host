# دليل النشر — ALTA HOST (§14-6, §14-7)

## المكوّنات
| الخدمة | الصورة | الغرض |
|---|---|---|
| db | postgres:16 | البيانات (residency: استضافة سعودية/خليجية للإنتاج) |
| redis | redis:7 | BullMQ + النشر الحي |
| minio | minio/minio | تخزين الملفات S3-متوافق (§5) |
| api | apps/api/Dockerfile | الـ API + العمال (worker/sweep/poll/scheduler in-process) |
| web | infra/web/Dockerfile | لوحة التحكم + Caddy (الواجهة الوحيدة المكشوفة) |
| waha | devlikeapro/waha | جسر واتساب للتجارب المحلية فقط |

## خطوات النشر
```bash
cp .env.example .env       # ثم املأ القيم — لا أسرار في المستودع
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run db:seed   # بيئة تجريبية فقط
```
الواجهة على WEB_PORT (افتراضي 8080)؛ كل شيء خلف Caddy — لا منفذ مباشر للـ API.

## متغيرات البيئة الحرجة
- `CREDENTIAL_ENCRYPTION_KEY` — 32 بايت base64. **بدونها ترفض الخزنة العمل.** غيّرها = كل الأسرار المخزنة تصبح غير قابلة للقراءة، فاحفظها في مدير أسرار.
- `JWT_SECRET` — توقيع جلسات الموظفين.
- `S3_PUBLIC_ENDPOINT` — يجب أن يكون قابلًا للوصول من متصفح الموظف (روابط موقّعة).
- `AUTO_APPROVE_INTENTS` — فارغ في الإطلاق (§7)؛ يُوسَّع تدريجيًا في مرحلة 61-90 يوم.
- `SOCIAL_PUBLISHER` — mock | meta.

## staging vs production
انسخ `docker-compose.yml` مع override: staging يضيف WAHA وseed؛ production بدونهما،
مع `NODE_ENV=production` ونسخ احتياطي مجدول (انظر BACKUP_RESTORE.md).

## CI
كل push: typecheck + build + الاختبارات (151+) ضد Postgres/Redis/MinIO حقيقية + بناء صور Docker.
عقد الـ API محروس: مسار جديد بدون توثيق OpenAPI يسقط البناء.
