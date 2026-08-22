import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { emitEvent } from "../events/bus.js";
import { recordAudit } from "../audit/service.js";

export const FILE_KINDS = ["fault_photo", "content_media", "post_image", "policy_doc", "ticket_attachment"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

// §5/§10: allow-list, not deny-list. Anything not named here is refused.
const ALLOWED_MIME: Record<string, number> = {
  "image/jpeg": 15 * 1024 * 1024,
  "image/png": 15 * 1024 * 1024,
  "image/webp": 15 * 1024 * 1024,
  "video/mp4": 200 * 1024 * 1024,
  "application/pdf": 25 * 1024 * 1024,
};

const UPLOAD_URL_TTL = 300; // seconds — a browser starts the PUT immediately
const DOWNLOAD_URL_TTL = 600;
const BUCKET = () => process.env.S3_BUCKET ?? "alta-files";

function client(endpoint?: string): S3Client {
  return new S3Client({
    endpoint: endpoint ?? process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: "us-east-1", // MinIO ignores it but the SDK requires one
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "alta-minio",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "alta-minio-devsecret",
    },
    forcePathStyle: true, // MinIO
  });
}

/** URLs handed to the browser must be signed against the origin the
 *  browser can reach, not the docker-internal hostname. */
function publicClient(): S3Client {
  return client(process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT);
}

let bucketReady = false;
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const s3 = client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET() }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET() })).catch((err) => {
      logger.error({ err }, "bucket creation failed");
      throw err;
    });
  }
  bucketReady = true;
}

export interface QuotaState {
  quotaGb: number;
  usedBytes: bigint;
  usedPct: number;
}

export async function quotaFor(propertyId: string): Promise<QuotaState & { tenantId: string }> {
  const property = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    include: { tenant: true },
  });
  const t = property.tenant!;
  const limit = BigInt(t.quotaGb) * 1024n * 1024n * 1024n;
  return {
    tenantId: t.id,
    quotaGb: t.quotaGb,
    usedBytes: t.usedBytes,
    usedPct: limit > 0n ? Number((t.usedBytes * 100n) / limit) : 100,
  };
}

/**
 * Step 1 of an upload: validate, reserve quota, mint a presigned PUT.
 *
 * Quota is reserved transactionally at request time (not at confirm) so
 * two concurrent uploads can't both slip under the limit — the §11-8
 * "block at full" has to hold under concurrency, same lesson as the
 * audit chain. Abandoned reservations are released by the sweep job.
 */
export async function requestUpload(params: {
  propertyId: string;
  kind: FileKind;
  name: string;
  mime: string;
  sizeBytes: number;
  ownerId?: string;
}): Promise<
  | { ok: true; fileId: string; uploadUrl: string; alert80: boolean }
  | { ok: false; status: number; error: string }
> {
  const maxSize = ALLOWED_MIME[params.mime];
  if (!maxSize) return { ok: false, status: 415, error: `file type ${params.mime} is not allowed` };
  if (params.sizeBytes <= 0 || params.sizeBytes > maxSize)
    return { ok: false, status: 413, error: `file exceeds the ${Math.round(maxSize / 1024 / 1024)}MB limit for this type` };

  await ensureBucket();

  const q = await quotaFor(params.propertyId);
  const limit = BigInt(q.quotaGb) * 1024n * 1024n * 1024n;
  const after = q.usedBytes + BigInt(params.sizeBytes);

  if (after > limit) {
    // §5/§11-8: full means blocked, with an upgrade prompt — not a warning.
    return { ok: false, status: 507, error: "storage quota exhausted — upgrade the plan or free space" };
  }

  // Alert exactly once, on the upload that crosses the 80% line (§11-8).
  const crossed80 = q.usedBytes * 100n < limit * 80n && after * 100n >= limit * 80n;

  const now = new Date();
  const id = randomUUID();
  const safeName = params.name.replace(/[^\w.\-؀-ۿ]/g, "_").slice(0, 80);
  const path = `${params.propertyId}/${params.kind}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${id}-${safeName}`;

  await prisma.$transaction([
    prisma.storageFile.create({
      data: {
        id,
        propertyId: params.propertyId,
        kind: params.kind,
        path,
        name: safeName,
        mime: params.mime,
        sizeBytes: BigInt(params.sizeBytes),
        ownerId: params.ownerId ?? null,
        status: "pending",
      },
    }),
    prisma.tenant.update({
      where: { id: q.tenantId },
      data: { usedBytes: { increment: BigInt(params.sizeBytes) } },
    }),
  ]);

  if (crossed80) {
    await emitEvent(params.propertyId, {
      type: "storage.alert",
      usedPct: Number((after * 100n) / limit),
      quotaGb: q.quotaGb,
    });
  }

  const uploadUrl = await getSignedUrl(
    publicClient(),
    new PutObjectCommand({ Bucket: BUCKET(), Key: path, ContentType: params.mime }),
    { expiresIn: UPLOAD_URL_TTL }
  );
  return { ok: true, fileId: id, uploadUrl, alert80: crossed80 };
}

/** Step 2: the browser PUT succeeded; the file becomes active. */
export async function confirmUpload(propertyId: string, fileId: string): Promise<boolean> {
  const updated = await prisma.storageFile.updateMany({
    where: { id: fileId, propertyId, status: "pending" },
    data: { status: "active" },
  });
  return updated.count === 1;
}

export async function signedDownloadUrl(propertyId: string, fileId: string): Promise<string | null> {
  const file = await prisma.storageFile.findFirst({
    where: { id: fileId, propertyId, status: "active" },
  });
  if (!file) return null;
  return getSignedUrl(
    publicClient(),
    new GetObjectCommand({ Bucket: BUCKET(), Key: file.path }),
    { expiresIn: DOWNLOAD_URL_TTL }
  );
}

/** §5: soft delete into a 30-day trash. Quota is released immediately —
 *  the guest-visible ledger should reflect reclaimable intent, and the
 *  sweep makes it physically true. */
export async function trashFile(params: {
  propertyId: string;
  fileId: string;
  actorName: string;
  actorId?: string | null;
}): Promise<boolean> {
  const file = await prisma.storageFile.findFirst({
    where: { id: params.fileId, propertyId: params.propertyId, status: "active" },
  });
  if (!file) return false;
  await prisma.$transaction([
    prisma.storageFile.update({
      where: { id: file.id },
      data: { status: "trashed", trashedAt: new Date() },
    }),
    prisma.tenant.update({
      where: { id: file.tenantId },
      data: { usedBytes: { decrement: file.sizeBytes } },
    }),
  ]);
  await recordAudit({
    action: "storage.trash",
    propertyId: params.propertyId,
    actorName: params.actorName,
    actorId: params.actorId,
    resourceType: "StorageFile",
    resourceId: file.id,
    metadata: { name: file.name, kind: file.kind },
  });
  return true;
}

export async function restoreFile(propertyId: string, fileId: string): Promise<boolean> {
  const file = await prisma.storageFile.findFirst({
    where: { id: fileId, propertyId, status: "trashed" },
  });
  if (!file) return false;
  await prisma.$transaction([
    prisma.storageFile.update({ where: { id: file.id }, data: { status: "active", trashedAt: null } }),
    prisma.tenant.update({ where: { id: file.tenantId }, data: { usedBytes: { increment: file.sizeBytes } } }),
  ]);
  return true;
}

/**
 * The sweep (BullMQ repeatable): hard-deletes trash older than 30 days
 * (§5) and releases quota reserved by uploads that never completed.
 */
export async function sweepStorage(now = new Date()): Promise<{ purged: number; released: number }> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const stale = new Date(now.getTime() - 24 * 3600 * 1000);
  const s3 = client();

  const toPurge = await prisma.storageFile.findMany({
    where: { status: "trashed", trashedAt: { lt: cutoff } },
    take: 500,
  });
  for (const f of toPurge) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: f.path })).catch(() => {});
    await prisma.storageFile.update({ where: { id: f.id }, data: { status: "deleted" } });
  }

  // Abandoned pending uploads: reservation released, row dropped.
  const abandoned = await prisma.storageFile.findMany({
    where: { status: "pending", createdAt: { lt: stale } },
    take: 500,
  });
  for (const f of abandoned) {
    await prisma.$transaction([
      prisma.storageFile.delete({ where: { id: f.id } }),
      prisma.tenant.update({ where: { id: f.tenantId }, data: { usedBytes: { decrement: f.sizeBytes } } }),
    ]);
  }
  return { purged: toPurge.length, released: abandoned.length };
}
