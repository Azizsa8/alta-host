import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { intentWorkflow } from "./workflows/intent.js";

let instance: Mastra | undefined;

/** Lazy so importing this module never opens a DB connection at boot —
 *  the legacy orchestrator path must not pay for Mastra it doesn't use. */
export function getMastra(): Mastra {
  instance ??= new Mastra({
    workflows: { intentWorkflow },
    // `id` is required by PostgresStore — omitting it throws at construction.
    storage: new PostgresStore({
      id: "alta-pg",
      connectionString: process.env.DATABASE_URL!,
    }),
  });
  return instance;
}

/** ORCHESTRATOR=mastra routes intent dispatch through the workflow runtime
 *  (durable suspend/resume review gate). Anything else keeps the legacy
 *  switch, so the swap rolls back with one env var. */
export function isMastraOrchestrator(): boolean {
  return process.env.ORCHESTRATOR === "mastra";
}
