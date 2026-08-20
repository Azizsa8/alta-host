import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";

export interface SealedValue {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/**
 * Derives the 32-byte key from CREDENTIAL_ENCRYPTION_KEY.
 *
 * Accepts either a base64-encoded 32-byte key (what you should use) or an
 * arbitrary passphrase, which is hashed to 32 bytes so a misconfigured
 * deploy fails safe rather than crashing. Refuses to run without one:
 * silently falling back to a default key would mean credentials that look
 * encrypted but aren't protected by anything.
 */
function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set — refusing to store credentials with no real key. " +
        "Generate one with: openssl rand -base64 32"
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  // Not a 32-byte base64 key — treat it as a passphrase.
  return createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypts a plaintext secret. A fresh IV per write means identical
 *  values never produce identical ciphertext. */
export function seal(plaintext: string): SealedValue {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv(ALGO, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/**
 * Decrypts a sealed value. GCM verifies the auth tag, so a value edited
 * directly in the database throws rather than returning garbage that the
 * caller would then send to a PMS as if it were a real token.
 */
export function open(sealed: SealedValue): string {
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a usable encryption key is configured. Lets callers degrade
 *  gracefully (skip the vault, use env vars) instead of crashing at boot. */
export function credentialsConfigured(): boolean {
  return Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY);
}
