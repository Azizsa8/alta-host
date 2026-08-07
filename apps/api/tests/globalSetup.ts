import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "./testEnv.js";

// apps/api — the cwd `prisma migrate deploy` needs to find prisma/schema.prisma.
const apiRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function testDatabaseName(): string {
  const match = TEST_DATABASE_URL.match(/\/([^/?]+)(\?.*)?$/);
  if (!match) throw new Error(`could not parse a database name out of ${TEST_DATABASE_URL}`);
  return match[1];
}

function adminDatabaseUrl(): string {
  // Any ordinary database is fine here — we only use it to issue
  // `CREATE DATABASE`. Defaults to the same instance/credentials the app
  // uses in dev (see .env.example), just not the test database itself.
  return process.env.DATABASE_URL ?? "postgresql://alta:devpassword@localhost:5432/alta";
}

/**
 * Runs once before the whole test run: makes sure a dedicated test database
 * exists (separate from dev/"alta", per the task brief) and is migrated to
 * the current schema. Individual test files connect to it via the
 * DATABASE_URL vitest injects from tests/testEnv.ts.
 */
export default async function globalSetup() {
  const dbName = testDatabaseName();
  const admin = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl() } } });
  try {
    const rows = await admin.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${dbName}') as exists`
    );
    if (!rows[0]?.exists) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
