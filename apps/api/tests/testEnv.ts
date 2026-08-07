// Resolves the DATABASE_URL the test suite runs against — deliberately a
// database separate from local/dev ("alta") so `npm run test` never
// clobbers dev data. Override with TEST_DATABASE_URL if you need a
// different host/port (e.g. a non-default docker-compose DB_PORT).
function deriveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "postgresql://alta:devpassword@localhost:5432/alta";
  // Swap whatever database name is in the URL for "alta_test", preserving
  // any query string (e.g. ?schema=public).
  return base.replace(/\/([^/?]+)(\?.*)?$/, "/alta_test$2");
}

export const TEST_DATABASE_URL = deriveTestDatabaseUrl();
