import { defineConfig } from "vitest/config";

export default defineConfig({
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
