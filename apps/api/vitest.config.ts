import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/testEnv.js";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/globalSetup.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Most tests hit a real (dedicated) Postgres database — run files
    // serially so they don't fight over connections/rows during setup.
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
