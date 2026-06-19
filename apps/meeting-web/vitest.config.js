import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  esbuild: {
    // No forced `loader: "jsx"`: it would apply the JSX loader to workspace TS
    // source (e.g. @product-suite/ui-chat's .ts) and choke on `export type`.
    // Extension defaults are correct here — .jsx -> jsx (automatic), .ts -> ts,
    // .js -> js — because meeting-web has no JSX in plain .js files.
    include: /src[\\/].*\.[jt]sx?$/,
    jsx: "automatic",
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
