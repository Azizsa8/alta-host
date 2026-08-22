import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Caddy fronts the api container (docker-compose no longer publishes
      // 4317 directly) — WEB_PORT defaults to 8080 but this machine runs 8098.
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8098",
    },
  },
});
