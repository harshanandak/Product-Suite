import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@product-suite/contracts": fileURLToPath(
        new URL("./node_modules/@product-suite/contracts/src/index.js", import.meta.url),
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
