import pino from "pino";

// Shared structured logger for the API. Pretty-prints in development so logs
// stay readable in a terminal; ships plain JSON lines in production so they
// can be parsed by a log aggregator.
const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
      },
});
