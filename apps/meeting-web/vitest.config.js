import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  esbuild: {
    include: /src[\\/].*\.[jt]sx?$/,
    jsx: "automatic",
    loader: "jsx",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@product-suite/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.js"),
    },
    preserveSymlinks: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
    setupFiles: ["./vitest.setup.js"],
  },
});
