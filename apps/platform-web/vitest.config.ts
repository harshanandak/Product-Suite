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
    // The 5s default is too tight for this suite's heaviest component tests
    // (React Flow canvas + Radix sheets/menus + userEvent simulate real
    // interaction with internal delays) once a machine or CI runner is under
    // load — they flake as timeouts despite being correct. 15s matches the
    // project's own `bun test --timeout 15000` watcher convention.
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
