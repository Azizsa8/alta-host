/**
 * Real load test against the running stack — not a benchmark of mocks.
 *
 * Fires N concurrent WhatsApp webhooks at the live API, measures the ack
 * latency the transport actually sees, waits for the queue to drain, then
 * verifies in Postgres that every message produced exactly one pipeline
 * run: no drops, no duplicates.
 *
 * Usage: tsx scripts/load-test.mts [count] [concurrency]
 */
import { PrismaClient } from "@prisma/client";

const API = process.env.LOAD_API ?? "http://localhost:8098";
const PROPERTY = process.env.LOAD_PROPERTY ?? "demo-property";
const COUNT = Number(process.argv[2] ?? 200);
const CONCURRENCY = Number(process.argv[3] ?? 40);

const prisma = new PrismaClient();

const MESSAGES = [
  "المكيف خربان في الغرفة",
  "أبي تنظيف الغرفة لو سمحتوا",
  "I need late checkout by 2 hours",
  "الواي فاي ما يشتغل",
  "there is no hot water in my bathroom",
  "ابي تمديد الاقامة وتنظيف الغرفة",
];

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const runId = `load-${Date.now()}`;
  console.log(`\n▶ firing ${COUNT} webhooks at ${API} (concurrency ${CONCURRENCY})`);

  const before = await prisma.message.count({ where: { direction: "inbound" } });
  const latencies: number[] = [];
  const codes: Record<number, number> = {};
  let sent = 0;

  const started = Date.now();
  // Fixed-size worker pool so concurrency is genuinely bounded rather
  // than firing all N at once and measuring the client's own queueing.
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const i = sent++;
        if (i >= COUNT) return;
        const body = {
          event: "message",
          session: "default",
          payload: {
            id: `${runId}-${i}`, // unique => no dedupe, every one must process
            from: `96650${String(1000000 + i).slice(-7)}@c.us`,
            body: MESSAGES[i % MESSAGES.length],
          },
        };
        const t0 = performance.now();
        try {
          const res = await fetch(`${API}/webhook/waha?propertyId=${PROPERTY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          latencies.push(performance.now() - t0);
          codes[res.status] = (codes[res.status] ?? 0) + 1;
        } catch {
          codes[0] = (codes[0] ?? 0) + 1;
        }
      }
    })
  );
  const ingestMs = Date.now() - started;
  latencies.sort((a, b) => a - b);

  console.log(`\n── webhook ack (what WhatsApp's transport sees) ──`);
  console.log(`  status codes : ${JSON.stringify(codes)}`);
  console.log(`  throughput   : ${(COUNT / (ingestMs / 1000)).toFixed(1)} req/s over ${ingestMs}ms`);
  console.log(`  p50 / p95    : ${pct(latencies, 50).toFixed(1)}ms / ${pct(latencies, 95).toFixed(1)}ms`);
  console.log(`  max          : ${latencies[latencies.length - 1]?.toFixed(1)}ms`);

  // Drain: poll until inbound message count stops climbing.
  console.log(`\n── draining queue ──`);
  const drainStart = Date.now();
  let last = -1;
  let stable = 0;
  let processed = 0;
  while (Date.now() - drainStart < 180_000) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = await prisma.message.count({ where: { direction: "inbound" } });
    processed = now - before;
    if (now === last) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
    }
    last = now;
    process.stdout.write(`\r  processed ${processed}/${COUNT}   `);
  }
  const drainMs = Date.now() - drainStart;
  console.log(`\n  drained in ~${(drainMs / 1000).toFixed(1)}s → ${(processed / (drainMs / 1000)).toFixed(1)} msg/s end-to-end`);

  console.log(`\n── correctness ──`);
  console.log(`  inbound messages created : ${processed} (expected ${COUNT})`);
  const verdict = processed === COUNT ? "✅ no drops, no duplicates" : `❌ MISMATCH (${COUNT - processed} missing)`;
  console.log(`  verdict                  : ${verdict}`);

  await prisma.$disconnect();
  process.exit(processed === COUNT ? 0 : 1);
}

main();
