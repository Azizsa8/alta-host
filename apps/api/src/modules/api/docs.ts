import { Router } from "express";
import { createRequire } from "node:module";
import express from "express";
import { buildOpenApiSpec } from "./openapi.js";
import { completeOauth } from "../social/connect.js";

const require = createRequire(import.meta.url);

/**
 * §14: /api/docs — Swagger UI, self-hosted (no CDN; the dashboard's own
 * deployment posture applies to its docs too). The JSON at
 * /api/docs/openapi.json imports directly into Postman/Insomnia.
 * Docs are public-read: the spec contains no secrets, and pilots need it
 * before they have staff tokens.
 */
export const docsRouter = Router();

const spec = buildOpenApiSpec();

docsRouter.get("/docs/openapi.json", (_req, res) => {
  res.json(spec);
});

docsRouter.get("/docs", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <title>ALTA HOST API</title>
  <link rel="stylesheet" href="/api/docs/assets/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: "/api/docs/openapi.json", dom_id: "#swagger-ui", docExpansion: "none" });
  </script>
</body>
</html>`);
});

/**
 * The OAuth callback is mounted on the PUBLIC docs router because the
 * platform redirects the hotel's browser here with no Authorization
 * header. Its own authority is the signed `state` parameter, which proves
 * we issued the request and names the property — so a callback cannot
 * connect a channel to a hotel that never asked for it.
 */
docsRouter.get("/social/oauth/callback", (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) {
    res.status(400).type("html").send(page("تعذّر إكمال الربط", "الرابط ناقص — أعد المحاولة من شاشة القنوات."));
    return;
  }
  completeOauth({ state, code })
    .then((r) => {
      if (r.ok) res.type("html").send(page("تم ربط القناة ✅", "يمكنك إغلاق هذه النافذة والعودة إلى لوحة التحكم."));
      else res.status(400).type("html").send(page("تعذّر إكمال الربط", r.error));
    })
    .catch(() => res.status(500).type("html").send(page("تعذّر إكمال الربط", "خطأ غير متوقع.")));
});

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${title}</title><style>
body{font-family:system-ui,sans-serif;background:#0E0B14;color:#F3EFF7;display:grid;place-items:center;height:100vh;margin:0}
div{text-align:center;max-width:32ch}h1{font-size:22px;margin:0 0 8px}p{color:#9A8FA8;font-size:14px}
</style></head><body><div><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

const swaggerDist: string = require("swagger-ui-dist").getAbsoluteFSPath();
docsRouter.use("/docs/assets", express.static(swaggerDist, { index: false }));
