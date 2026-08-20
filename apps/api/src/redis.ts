import { Redis } from "ioredis";

const url = () => process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires maxRetriesPerRequest: null on its connections; harmless
// for our own use, so one shared config keeps the two paths identical.
export function createRedisConnection(): Redis {
  return new Redis(url(), { maxRetriesPerRequest: null });
}

let shared: Redis | undefined;
/** Lazy shared connection for publishes and one-off commands. Subscribers
 *  and BullMQ workers must call createRedisConnection() instead — a Redis
 *  connection in subscriber mode can't issue regular commands. */
export function getRedis(): Redis {
  shared ??= createRedisConnection();
  return shared;
}
