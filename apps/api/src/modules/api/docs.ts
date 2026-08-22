import { Router } from "express";
import { createRequire } from "node:module";
import express from "express";
import { buildOpenApiSpec } from "./openapi.js";

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

const swaggerDist: string = require("swagger-ui-dist").getAbsoluteFSPath();
docsRouter.use("/docs/assets", express.static(swaggerDist, { index: false }));
