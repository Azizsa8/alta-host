import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const apiRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SEEDERS = ["prisma/demo-seed.ts", "scripts/seed-demo-history.ts"];

/**
 * The audit chain's hash covers seq, createdAt and every field of the row.
 * A seeder that inserts AuditEvent directly has to reproduce that formula
 * by hand, and when it drifts — as demo-seed.ts once did — /audit/verify
 * reports the platform's own seeded rows as ALTERED, disproving the exact
 * tamper-evidence claim the demo exists to show. Insert through
 * recordAudit() instead, which owns the formula.
 */
describe("demo seeders keep the audit chain verifiable", () => {
  for (const rel of SEEDERS) {
    it(`${rel} writes audit entries through recordAudit(), not a raw insert`, async () => {
      const src = await readFile(path.join(apiRoot, rel), "utf8");
      expect(src).toContain("recordAudit(");
      expect(src).not.toMatch(/auditEvent\.create\s*\(/);
      // and does not recompute the chain hash on its own
      expect(src).not.toMatch(/prevHash\s*[,:]/);
    });
  }
});
