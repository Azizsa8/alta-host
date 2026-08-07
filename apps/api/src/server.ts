import "dotenv/config";
import express from "express";
import cors from "cors";
import { whatsappRouter } from "./modules/whatsapp/webhook.js";
import { apiRouter } from "./modules/api/routes.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(whatsappRouter);
app.use("/api", apiRouter);

const port = Number(process.env.PORT ?? 4317);
app.listen(port, () => {
  console.log(`ALTA API listening on http://localhost:${port}`);
});
