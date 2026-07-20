import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5199;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Standalone Playwright config for the Lane C screenshot harness. Unlike the
 * moat-loop config (Clerk + Neon + real backend), this boots ONLY the mock-driven
 * `e2e-harness/` Vite app and drives `ProposalDetail` against mocked accept
 * envelopes — no auth, no DB, no secrets. Kept separate (its own testDir) so the
 * default `bun run e2e` (testDir `e2e/`) never picks it up.
 *
 * The harness Vite child inherits `ESBUILD_BINARY_PATH` from the parent env when
 * set (a Windows dev-store workaround); on a clean install it is unnecessary.
 */
export default defineConfig({
  testDir: path.join(here, "e2e-harness"),
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(here, "e2e-harness", "test-results"),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run harness",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
