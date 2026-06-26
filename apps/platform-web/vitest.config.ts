import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    // Heavy React component tests (the work-item table + editor sheet, and the
    // React Flow graph) can exceed the 5s default when the monorepo pre-push
    // gate runs workspace suites concurrently. Match the headroom the rest of
    // the stack uses so the gate isn't load-flaky.
    testTimeout: 15000,
    hookTimeout: 15000,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    server: {
      deps: {
        inline: ["@product-suite/ui"],
      },
    },
  },
});
