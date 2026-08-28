import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { recordAudit } from "../audit/service.js";
import { seal, open, credentialsConfigured } from "./crypto.js";
import { CHANNEL_KEYS as SOCIAL_CHANNEL_KEYS } from "../social/catalogue.js";

/** Credential keys this system knows how to consume. Constraining the set
 *  keeps the vault from quietly becoming a general-purpose key-value store
 *  that nothing reads. */
export const CREDENTIAL_KEYS = [
  "mews.clientToken",
  "mews.accessToken",
  "mews.platformAddress",
  "whatsapp.cloudApiToken",
  "whatsapp.phoneNumberId",
  "google.oauthRefreshToken", // GBP reviews — §6-د, stored on account link
  "google.locationId",
  "meta.pageToken", // Instagram/Facebook publishing — §6-هـ
  "meta.pageId",
] as const;

/** Per-channel connection credentials, derived from the channel catalogue
 *  rather than hand-listed: the set stays closed and reviewable (a typo
 *  cannot invent a key) while covering every channel the studio manages. */
export const SOCIAL_CREDENTIAL_KEYS = SOCIAL_CHANNEL_KEYS.flatMap((c) => [
  `social.${c}.token`,
  `social.${c}.account`,
]);

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number] | (string & {});

/** The complete allowlist the vault will accept. */
export function isKnownCredentialKey(key: string): boolean {
  return (CREDENTIAL_KEYS as readonly string[]).includes(key) || SOCIAL_CREDENTIAL_KEYS.includes(key);
}

export interface CredentialSummary {
  key: string;
  lastRotatedAt: string;
  lastAccessedAt: string | null;
  /** Enough to recognise a value without revealing it. */
  hint: string;
}

/** Stores or rotates a credential. The plaintext is never logged, never
 *  echoed back, and never persisted unencrypted. */
export async function setCredential(params: {
  propertyId: string;
  key: CredentialKey;
  value: string;
  actor: { actorId?: string | null; actorName: string; ip?: string; userAgent?: string };
}): Promise<void> {
  const sealed = seal(params.value);
  const existing = await prisma.propertyCredential.findUnique({
    where: { propertyId_key: { propertyId: params.propertyId, key: params.key } },
  });

  await prisma.propertyCredential.upsert({
    where: { propertyId_key: { propertyId: params.propertyId, key: params.key } },
    create: { propertyId: params.propertyId, key: params.key, ...sealed },
    update: { ...sealed, lastRotatedAt: new Date() },
  });

  await recordAudit({
    action: existing ? "credential.rotate" : "credential.create",
    propertyId: params.propertyId,
    resourceType: "PropertyCredential",
    resourceId: params.key,
    // Deliberately records that a credential changed, never what it is.
    metadata: { key: params.key },
    ...params.actor,
  });
}

/**
 * Reads a credential for actual use by an adapter.
 *
 * Every read is audited: "which system read our Mews token, and when" is
 * a question a hotel's security team is entitled to ask. Returns null
 * rather than throwing when absent, so callers can fall back to env vars
 * during migration.
 */
export async function getCredential(
  propertyId: string,
  key: CredentialKey,
  reason: string
): Promise<string | null> {
  if (!credentialsConfigured()) return null;

  const row = await prisma.propertyCredential.findUnique({
    where: { propertyId_key: { propertyId, key } },
  });
  if (!row) return null;

  try {
    const value = open(row);
    await prisma.propertyCredential.update({
      where: { id: row.id },
      data: { lastAccessedAt: new Date() },
    });
    await recordAudit({
      action: "credential.read",
      propertyId,
      actorName: "system",
      resourceType: "PropertyCredential",
      resourceId: key,
      metadata: { key, reason },
    });
    return value;
  } catch (err) {
    // GCM auth failure: the stored value was altered, or the encryption
    // key changed. Either way this is a security event, not a warning.
    logger.error({ err, propertyId, key }, "CREDENTIAL DECRYPT FAILED — value altered or key rotated");
    await recordAudit({
      action: "credential.read",
      outcome: "failure",
      propertyId,
      actorName: "system",
      resourceType: "PropertyCredential",
      resourceId: key,
      metadata: { key, reason, error: "decrypt failed" },
    });
    return null;
  }
}

/** Lists which credentials exist for a property — never their values. */
export async function listCredentials(propertyId: string): Promise<CredentialSummary[]> {
  const rows = await prisma.propertyCredential.findMany({
    where: { propertyId },
    orderBy: { key: "asc" },
  });
  return rows.map((r) => ({
    key: r.key,
    lastRotatedAt: r.lastRotatedAt.toISOString(),
    lastAccessedAt: r.lastAccessedAt?.toISOString() ?? null,
    // Length of the ciphertext only — enough to tell "set" from "empty",
    // useless for reconstructing the secret.
    hint: `${r.ciphertext.length} chars encrypted`,
  }));
}

export async function deleteCredential(params: {
  propertyId: string;
  key: string;
  actor: { actorId?: string | null; actorName: string; ip?: string; userAgent?: string };
}): Promise<boolean> {
  const deleted = await prisma.propertyCredential
    .delete({ where: { propertyId_key: { propertyId: params.propertyId, key: params.key } } })
    .catch(() => null);
  if (!deleted) return false;

  await recordAudit({
    action: "credential.delete",
    propertyId: params.propertyId,
    resourceType: "PropertyCredential",
    resourceId: params.key,
    metadata: { key: params.key },
    ...params.actor,
  });
  return true;
}
