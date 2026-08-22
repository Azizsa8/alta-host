# النسخ الاحتياطي والاستعادة (§5, §14-8)

## ما الذي يُنسخ
1. **Postgres** — كل بيانات الأعمال + سلسلة التدقيق.
2. **MinIO** — ملفات `alta-files` (صور الأعطال، الوسائط).
3. **`.env`** — خصوصًا `CREDENTIAL_ENCRYPTION_KEY`: نسخة قاعدة بيانات بدون هذا المفتاح تفقد كل أسرار الخزنة.

## نسخ يومي (cron مقترح 03:00)
```bash
docker compose exec -T db pg_dump -U alta -Fc alta > backups/alta-$(date +%F).dump
docker run --rm --network app_default -v $PWD/backups:/backups \
  minio/mc sh -c "mc alias set m http://minio:9000 \$S3_ACCESS_KEY \$S3_SECRET_KEY && mc mirror m/alta-files /backups/files-$(date +%F)"
```
احتفظ بـ 30 يومًا؛ انقل نسخة أسبوعية خارج الخادم.

## الاستعادة
```bash
createdb -U alta alta_restored
pg_restore -U alta -d alta_restored backups/alta-YYYY-MM-DD.dump
# تحقّق قبل التبديل:
psql -U alta -d alta_restored -c 'SELECT count(*) FROM "AuditEvent"'
# ثم وجّه DATABASE_URL إلى القاعدة المستعادة وأعد تشغيل api
```
بعد أي استعادة شغّل `GET /api/audit/verify` — يجب أن تعود السلسلة `valid: true`.

## بروفة منفّذة (§14-8)
نُفِّذت بتاريخ 2026-08-22 على بيئة التطوير: dump كامل → استعادة إلى `alta_rehearsal` →
تطابق عدد الصفوف في Property/StaffMember/AuditEvent مع الأصل، وتحقق سلسلة التدقيق سليم.
السجل الكامل في نهاية هذا الملف.

```
2026-08-22 — بروفة الاستعادة
dump: 635KB (pg_dump -Fc)
restored to: alta_rehearsal
Property: 2 vs 2 OK | StaffMember: 13 vs 13 OK | AuditEvent: 38 vs 38 OK
GoogleReview: 4 vs 4 OK | ContentItem: 2 vs 2 OK | WorkOrder: 1 vs 1 OK | StorageFile: 2 vs 2 OK
```
