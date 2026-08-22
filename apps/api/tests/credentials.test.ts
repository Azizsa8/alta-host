import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db.js";
import { seal, open } from "../src/modules/credentials/crypto.js";
import {
  setCredential,
  getCredential,
  listCredentials,
  deleteCredential,
} from "../src/modules/credentials/service.js";

/**
 * The claims worth testing are the ones a security review would probe:
 * the value is genuinely unreadable at rest, tampering is detected rather
 * than silently returning garbage, and nothing anywhere returns plaintext
 * except the one call meant to.
 */
describe("credential vault", () => {
  const propertyId = `cred-test-${Date.now()}`;
  const SECRET = "mews-super-secret-token-value-12345";
  const actor = { actorId: null, actorName: "tester" };

  beforeAll(async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
    await prisma.property.create({ data: { id: propertyId, name: "Vault Test Hotel" } });
  });

  it("round-trips a value through encryption", () => {
    const sealed = seal(SECRET);
    expect(sealed.ciphertext).not.toContain(SECRET);
    expect(open(sealed)).toBe(SECRET);
  });

  it("produces different ciphertext for the same value each time", () => {
    // A fixed IV would let anyone spot two properties sharing a token.
    const a = seal(SECRET);
    const b = seal(SECRET);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(open(a)).toBe(open(b));
  });

  it("rejects a tampered value instead of returning garbage", () => {
    const sealed = seal(SECRET);
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(() => open({ ...sealed, ciphertext: flipped.toString("base64") })).toThrow();
  });

  it("stores nothing readable in the database", async () => {
    await setCredential({ propertyId, key: "mews.clientToken", value: SECRET, actor });

    const row = await prisma.propertyCredential.findFirstOrThrow({ where: { propertyId } });
    // The whole row, serialised, must not contain the secret anywhere.
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(row.ciphertext).not.toContain(SECRET);
  });

  it("returns the value only through getCredential", async () => {
    expect(await getCredential(propertyId, "mews.clientToken", "test")).toBe(SECRET);

    const listed = await listCredentials(propertyId);
    expect(listed).toHaveLength(1);
    expect(listed[0].key).toBe("mews.clientToken");
    // The summary must not carry the value in any field.
    expect(JSON.stringify(listed)).not.toContain(SECRET);
  });

  it("audits reads and rotations without recording the value", async () => {
    await setCredential({ propertyId, key: "mews.accessToken", value: SECRET, actor });
    await getCredential(propertyId, "mews.accessToken", "pms adapter");

    const entries = await prisma.auditEvent.findMany({
      where: { propertyId, action: { startsWith: "credential." } },
    });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // The single most important assertion here: the audit trail itself
    // must never become the place the secret leaks.
    const serialised = JSON.stringify(entries, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(serialised).not.toContain(SECRET);
    expect(entries.some((e) => e.action === "credential.read")).toBe(true);
  });

  it("rotation replaces the value and is recorded as a rotation", async () => {
    await setCredential({ propertyId, key: "mews.clientToken", value: "rotated-value", actor });
    expect(await getCredential(propertyId, "mews.clientToken", "test")).toBe("rotated-value");

    const rotations = await prisma.auditEvent.count({
      where: { propertyId, action: "credential.rotate" },
    });
    expect(rotations).toBeGreaterThanOrEqual(1);
  });

  it("deletes a credential", async () => {
    expect(await deleteCredential({ propertyId, key: "mews.accessToken", actor })).toBe(true);
    expect(await getCredential(propertyId, "mews.accessToken", "test")).toBeNull();
    expect(await deleteCredential({ propertyId, key: "mews.accessToken", actor })).toBe(false);
  });
});
