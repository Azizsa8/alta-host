import { Redis } from "ioredis";

const url = () => process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires maxRetriesPerRequest: null on its connections. ioredis
// emits 'error' events on connection failure; without a listener Node
// treats each as an unhandled error, so every connection gets one.
export function createRedisConnection(): Redis {
  const conn = new Redis(url(), { maxRetriesPerRequest: null });
  conn.on("error", () => {
    /* logged by the consumer that sees the failed operation */
  });
  return conn;
}

let shared: Redis | undefined;
/** Lazy shared connection for publishes and one-off commands. Subscribers
 *  and BullMQ workers must call createRedisConnection() instead — a Redis
 *  connection in subscriber mode can't issue regular commands.
 *  enableOfflineQueue is off so a publish against a dead Redis rejects
 *  immediately (callers catch it) instead of queueing forever — the event
 *  bus is persist-first and must never block on Redis. */
export function getRedis(): Redis {
  if (!shared) {
    shared = new Redis(url(), { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    shared.on("error", () => {
      /* publish failures are caught and logged at the call site */
    });
  }
  return shared;
}
