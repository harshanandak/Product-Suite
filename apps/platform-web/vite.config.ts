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
  optimizeDeps: {
    // Deps Vite's startup crawl CANNOT see, because nothing imports them
    // statically from the entry — they sit behind `import()` boundaries:
    //   - `@xyflow/react` + `dagre`: only reachable via
    //     `lazy(() => import("./graph/WorkboardGraph"))` in WorkboardScreen.
    //   - `react-grab`: `void import("react-grab")` in main.tsx, live whenever
    //     DEV is true — so every dev/E2E page load requests it.
    // Left undeclared, Vite discovers them mid-session on first navigation,
    // re-runs pre-bundling, and then hard-reloads the page to swap the new
    // chunks in. Under E2E that reload lands in the middle of a spec: it wipes
    // page state and costs a fresh esbuild pass, which is what pushed cold
    // moat-loop setup past its 120s budget while warm runs took ~20s.
    // Declaring them bundles all of it in the ONE startup pass instead.
    include: ["@xyflow/react", "dagre", "react-grab"],
  },
  server: {
    // Transform the entry and the lazy graph chunk at boot rather than on the
    // request that needs them, so the first navigation isn't paying for it.
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/boards/workboard/graph/WorkboardGraph.tsx",
      ],
    },
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
