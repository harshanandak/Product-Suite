import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@product-suite/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.js", import.meta.url),
      ),
      "@product-suite/ui-meeting": fileURLToPath(
        new URL("../../packages/ui-meeting/src/index.js", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx,js,jsx}"],
    exclude: [
      "e2e/**",
      "tests/**",
      "playwright.config.ts",
      "node_modules/**",
      ".next/**",
    ],
  },
});
