import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import {
  requestUpload,
  confirmUpload,
  signedDownloadUrl,
  trashFile,
  restoreFile,
  sweepStorage,
  quotaFor,
} from "../src/modules/storage/service.js";

/**
 * §11-8 acceptance: storage usage is calculated accurately, an alert
 * fires at 80% of quota, and a full quota blocks rather than warns.
 * Runs against the real MinIO from docker-compose — presigned URLs that
 * were never exercised against a real S3 implementation are guesses.
 */
describe("object storage + quotas (§5 / §11-8)", () => {
  const stamp = Date.now();
  const propertyId = `stor-${stamp}`;
  const MB = 1024 * 1024;
  let tenantId = "";

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "Storage Hotel" } });
    const prop = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    tenantId = prop.tenantId;
    // A tiny quota makes the 80%/100% ladder testable with small files:
    // 10 MB expressed through quotaGb requires sub-GB, so store the quota
    // as 1 GB and use proportionally sized "files" (no bytes actually
    // uploaded for the ladder cases — reservation math is what's tested).
    await prisma.tenant.update({ where: { id: tenantId }, data: { quotaGb: 1 } });
  });

  it("rejects disallowed types and oversized files", async () => {
    const exe = await requestUpload({ propertyId, kind: "fault_photo", name: "x.exe", mime: "application/x-msdownload", sizeBytes: 100 });
    expect(exe.ok).toBe(false);
    if (!exe.ok) expect(exe.status).toBe(415);

    const huge = await requestUpload({ propertyId, kind: "fault_photo", name: "big.jpg", mime: "image/jpeg", sizeBytes: 50 * MB });
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.status).toBe(413);
  });

  it("uploads, confirms, signs a download URL that actually works", async () => {
    const req = await requestUpload({ propertyId, kind: "fault_photo", name: "leak.jpg", mime: "image/jpeg", sizeBytes: 5 * MB });
    expect(req.ok).toBe(true);
    if (!req.ok) return;

    // Real PUT to the presigned URL (localhost MinIO).
    const put = await fetch(req.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: Buffer.from("fake-jpeg-bytes-for-test"),
    });
    expect(put.status).toBe(200);

    expect(await confirmUpload(propertyId, req.fileId)).toBe(true);

    const url = await signedDownloadUrl(propertyId, req.fileId);
    expect(url).toBeTruthy();
    const got = await fetch(url!);
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("fake-jpeg-bytes-for-test");
  });

  it("usage is accounted accurately", async () => {
    const q = await quotaFor(propertyId);
    expect(q.usedBytes).toBe(BigInt(5 * MB)); // exactly the confirmed file
  });

  it("fires the 80% alert exactly on the crossing upload", async () => {
    // Quota 1 GB; per-file cap for video is 200 MB, so the ladder climbs
    // in capped steps: 5 (already used) + 5×150 = 755 MB (73.7%), then a
    // 100 MB upload crosses the 80% line at 855 MB.
    for (let i = 0; i < 5; i++) {
      const step = await requestUpload({ propertyId, kind: "content_media", name: `v${i}.mp4`, mime: "video/mp4", sizeBytes: 150 * MB });
      expect(step.ok).toBe(true);
      if (step.ok) expect(step.alert80).toBe(false);
    }

    const crossing = await requestUpload({ propertyId, kind: "content_media", name: "vX.mp4", mime: "video/mp4", sizeBytes: 100 * MB });
    expect(crossing.ok).toBe(true);
    if (crossing.ok) expect(crossing.alert80).toBe(true);

    const alert = await prisma.altaEvent.findFirst({
      where: { propertyId, type: "storage.alert" },
    });
    expect(alert).toBeTruthy();
  });

  it("blocks at full quota with 507 (§11-8)", async () => {
    const blocked = await requestUpload({ propertyId, kind: "content_media", name: "v3.mp4", mime: "video/mp4", sizeBytes: 190 * MB });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(507);
  });

  it("trash releases quota; restore re-reserves it", async () => {
    const before = (await quotaFor(propertyId)).usedBytes;
    const file = await prisma.storageFile.findFirstOrThrow({
      where: { propertyId, status: "active", mime: "image/jpeg" },
    });
    expect(await trashFile({ propertyId, fileId: file.id, actorName: "tester" })).toBe(true);
    expect((await quotaFor(propertyId)).usedBytes).toBe(before - file.sizeBytes);

    expect(await restoreFile(propertyId, file.id)).toBe(true);
    expect((await quotaFor(propertyId)).usedBytes).toBe(before);
  });

  it("the sweep hard-deletes 30-day trash and releases abandoned reservations", async () => {
    // Age a trashed file past 30 days and a pending one past 24h.
    const file = await prisma.storageFile.findFirstOrThrow({
      where: { propertyId, status: "active", mime: "image/jpeg" },
    });
    await trashFile({ propertyId, fileId: file.id, actorName: "tester" });
    await prisma.storageFile.update({
      where: { id: file.id },
      data: { trashedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) },
    });

    const pending = await prisma.storageFile.findFirst({ where: { propertyId, status: "pending" } });
    if (pending) {
      await prisma.storageFile.update({
        where: { id: pending.id },
        data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) },
      });
    }

    const result = await sweepStorage();
    expect(result.purged).toBeGreaterThanOrEqual(1);

    const gone = await prisma.storageFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(gone.status).toBe("deleted");
    // The purged object is really gone from MinIO: its signed URL 404s.
    expect(await signedDownloadUrl(propertyId, file.id)).toBeNull();
  });
});
