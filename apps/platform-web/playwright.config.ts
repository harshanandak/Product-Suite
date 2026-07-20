import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load the E2E run vars into `process.env` without a dotenv dependency. Files are
 * read in PRECEDENCE order — `.env.e2e` (the canonical, documented file) first,
 * then `.dev.vars` as a fallback for anyone who keeps their local secrets there —
 * and a key already set (by the shell OR an earlier file) is NEVER overridden. So
 * `CLERK_SECRET_KEY=… bun run e2e` still wins, and `.env.e2e` beats `.dev.vars`.
 * Both files are gitignored; a missing file is a no-op (CI can supply vars directly).
 */
const ENV_FILES = [".env.e2e", ".dev.vars"] as const;

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function loadEnvFiles(): void {
  for (const name of ENV_FILES) loadEnvFile(path.join(here, name));
}
loadEnvFiles();

/**
 * A defined-only string view of `process.env` (Playwright's `webServer.env`
 * requires `Record<string, string>`, but `process.env` values are
 * `string | undefined`). The `VITE_`-prefixed keys must be present so the Vite
 * dev child boots the app against the right Clerk instance / default workspace.
 */
function childEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) out[k] = v;
  }
  out.VITE_CLERK_PUBLISHABLE_KEY = process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
  out.VITE_DEFAULT_WORKSPACE = process.env.VITE_DEFAULT_WORKSPACE ?? "";
  return out;
}

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
 * but the local baseURL is pinned to :5173. We force Vite onto :5173 in the
 * `webServer.command` (`--port 5173 --strictPort`) so the started server and the
 * baseURL always agree. `--strictPort` makes Vite FAIL FAST with a clear
 * "Port 5173 is already in use" error instead of silently drifting to another
 * port that Playwright's wait-for-url isn't watching (which would hang until the
 * webServer timeout). When a dev server is already up on :5173, Playwright reuses
 * it (`reuseExistingServer`, see below) rather than starting a second one — so a
 * deliberate reuse is fine while an accidental collision fails loudly. Export
 * `E2E_BASE_URL` to bypass the managed server entirely (deployed mode).
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
        // `--strictPort`: fail fast if :5173 is taken rather than drift to another
        // port Playwright isn't watching (see the port note above).
        command: "bun run dev --port 5173 --strictPort",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Forward the client (VITE_-prefixed) vars from `.env.e2e` to the Vite
        // child so `import.meta.env` boots the app against the right Clerk
        // instance and default workspace.
        env: childEnv(),
      },
});
