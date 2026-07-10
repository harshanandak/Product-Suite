import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  server: {
    port: 5180,
    strictPort: false,
    // Same-origin `/api/*` in dev: proxy to the local platform-api worker
    // (`wrangler dev` defaults to :8787). Set VITE_API_BASE_URL to bypass this
    // and target a cross-origin API host instead. Adjust the target port here if
    // the worker is started on a different one.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5180,
    strictPort: false,
  },
});
