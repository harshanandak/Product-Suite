import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * E2E "moat-loop" harness config.
 *
 * baseURL:
 *  - Local mode (default): `E2E_BASE_URL` unset ⇒ target the local Vite dev
 *    server and start it via `webServer` below.
 *  - Deployed mode: set `E2E_BASE_URL=https://<deployed-url>` to run the SAME
 *    specs against a live deploy; the `webServer` block is then skipped.
 *
 * NOTE on the local port: `vite.config.ts` defaults the dev server to :5180,
 * but the task pins the local baseURL to :5173. We therefore force Vite onto
 * :5173 in the `webServer.command` (`--port 5173`) so the started server and
 * the baseURL always agree. `strictPort` is false in vite.config, so if 5173 is
 * already taken Vite would pick another port and Playwright's wait-for-url would
 * fail — free 5173 first (or export E2E_BASE_URL to bypass the managed server).
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const IS_DEPLOYED = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: path.join(here, "e2e"),
  // Full moat loop hits real Clerk + Neon + OpenRouter, so a single serial run.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  // The agent-propose step waits on a real LLM round-trip, so give tests room.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Signs in a real Clerk test user once and saves storageState.
    { name: "setup", testMatch: /global\.setup\.e2e\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Start authenticated: reuse the storageState written by `setup`.
        storageState: path.join(here, "e2e", ".auth", "user.json"),
      },
      dependencies: ["setup"],
    },
  ],
  // Local mode only: boot the web app. Deployed mode targets E2E_BASE_URL, so
  // no server is managed here. This starts the WEB app only — the platform-API
  // worker (wrangler dev on :8787, which the Vite proxy forwards /api/* to) must
  // be running separately with real secrets for the loop to complete. See
  // e2e/README.md.
  webServer: IS_DEPLOYED
    ? undefined
    : {
        command: "bun run dev --port 5173",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
