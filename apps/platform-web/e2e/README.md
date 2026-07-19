# E2E — the "moat loop"

Proves the core moat end-to-end against a **real** backend:

> agent proposes → Review Inbox → **accept** → validated write applies to the workboard.

`moat-loop.spec.ts` drives the real UI (Clerk auth, agent chat, inbox, workboard).
`global.setup.e2e.ts` signs a real Clerk test user in once and saves `storageState`
so specs start authenticated. (The `.e2e.` in the name marks it as test infra for
the repo's source/test-coupling gate — Playwright picks it up via `testMatch`.)

## Why it can't be "just run"

The loop touches three real services whose secrets are **not** in the repo:

| Secret | Used by | Purpose |
| --- | --- | --- |
| `CLERK_SECRET_KEY` | `@clerk/testing` (setup) | mint a Clerk Testing Token for programmatic sign-in |
| `VITE_CLERK_PUBLISHABLE_KEY` | web app + setup | the Clerk instance the app boots with (same instance as the secret key) |
| `E2E_CLERK_USER` / `E2E_CLERK_PASSWORD` | setup | a password test user to sign in as |
| `DATABASE_URL` (Neon) | platform-API | the validated write actually persists |
| `OPENROUTER_API_KEY` | platform-API | the agent LLM produces the proposal |

Copy `apps/platform-web/.dev.vars.example` and fill these in. `.dev.vars` / `.env`
are gitignored.

## Run — LOCAL mode (default)

Three processes. The Vite dev server proxies `/api/*` → the local API worker on
`:8787`, so the API worker must run with real secrets.

```bash
# 1) API worker (from apps/platform-api) — needs DATABASE_URL + OPENROUTER_API_KEY
#    (+ Clerk keys) in its own .dev.vars. Serves on :8787.
bun run --cwd apps/platform-api dev        # wrangler dev

# 2) Web + tests (from apps/platform-web). Export the E2E/Clerk vars first, e.g.:
export CLERK_SECRET_KEY=sk_test_...
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
export E2E_CLERK_USER=e2e-tester@example.com
export E2E_CLERK_PASSWORD=...
# Playwright auto-starts `bun run dev --port 5173` (its webServer). Just run:
bun run --cwd apps/platform-web e2e
```

Playwright manages the **web** server (Vite on :5173) for you; you only start the
API worker manually. If :5173 is busy, free it (Vite's `strictPort` is false and
would drift to another port that Playwright isn't watching), or use deployed mode.

## Run — DEPLOYED mode

Point at a live deploy that already has all backend secrets set. No local servers
are started (the `webServer` block is skipped when `E2E_BASE_URL` is set):

```bash
export E2E_BASE_URL=https://<your-deploy-url>
export CLERK_SECRET_KEY=sk_test_...          # still needed to mint the token
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_... # must match the deploy's Clerk instance
export E2E_CLERK_USER=... E2E_CLERK_PASSWORD=...
bun run --cwd apps/platform-web e2e
```

## Notes

- `E2E_WORKSPACE` (default `befach-hq`) is the `/w/<workspace>/…` slug.
- The `setup` project must pass first (it writes `e2e/.auth/user.json`); the
  `chromium` project depends on it.
- Selectors are pulled from live source; a handful that depend on the running
  app (composer textbox, proposal-list item name, diff DOM, agent latency) are
  marked `// VERIFY against live app` in the spec — confirm them on the first
  real run and tighten if needed.
- Artifacts (`playwright-report/`, `test-results/`, `e2e/.auth/`) are gitignored.
