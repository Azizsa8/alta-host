import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { logger } from "./logger.js";
import { whatsappRouter } from "./modules/whatsapp/webhook.js";
import { apiRouter } from "./modules/api/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { sseRouter } from "./modules/events/sse.js";
import { startIngestWorker } from "./modules/ingest/queue.js";
import { startStorageSweep } from "./modules/storage/sweep.js";
import { isMastraOrchestrator } from "./modules/mastra/instance.js";

const app = express();
// Deployed behind exactly one reverse proxy (Caddy, see infra/web/Caddyfile /
// docker-compose.yml — the api service isn't exposed directly). Without this,
// express-rate-limit would key on Caddy's container IP for every request
// instead of the real client IP, collapsing all clients into one shared
// rate-limit bucket.
app.set("trust proxy", 1);
app.use(cors());
app.use(helmet());
app.use(pinoHttp({ logger }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// The WhatsApp webhook is public-facing (Meta calls it directly, no auth in
// front of it yet) so it gets a tighter cap than the rest of the API — just
// enough headroom for legitimate message bursts while blunting abuse/DoS
// attempts against an endpoint we can't otherwise lock down.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/webhook/whatsapp", webhookLimiter);

// General limit for the rest of the API — generous enough for normal
// dashboard/staff usage, tight enough to blunt scripted abuse.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

// Tighter cap specifically on login — the one write endpoint reachable
// without already having a token, so it's the credential-stuffing target.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", loginLimiter);

app.use(whatsappRouter);
// authRouter is mounted before apiRouter applies its own requireAuth
// middleware (see modules/api/routes.ts) — login/me must stay reachable
// without a token already in hand.
app.use("/api", authRouter);
// SSE live feed — one long-lived request per dashboard, auth'd via the
// same staff JWT (as ?token=, since EventSource can't set headers).
app.use("/api", sseRouter);
app.use("/api", apiRouter);

const port = Number(process.env.PORT ?? 4317);
app.listen(port, () => {
  logger.info(`ALTA API listening on http://localhost:${port}`);
});

// Inbound-message worker runs in-process for now — same container, so a
// deploy scales both together. Split into its own service when webhook
// volume outgrows one process.
startIngestWorker();
startStorageSweep();
logger.info(
  { orchestrator: isMastraOrchestrator() ? "mastra" : "legacy" },
  "ingest worker started"
);
