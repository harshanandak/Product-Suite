# platform-web

The single user-facing app for Product Suite — the **Zen shell** that hosts every
board (Home, Workboard, Meeting, Canvas, Agent) as route groups in one SPA.
This is the Phase 0 / F1 foundation every lane builds on.

See [DESIGN.md](../../DESIGN.md) (the contract — §2 navigation, §5 components,
§10 stack) and [docs/design/user-flow-wireframes.html](../../docs/design/user-flow-wireframes.html)
(the prototype the chrome matches).

## Stack (DESIGN §10, decided)

- **Vite 7** + **React 19** SPA — logged-in app, no SSR.
- **TanStack Router** (library, code-based routing — not Start).
- **Clerk** GA React SDK (`@clerk/clerk-react`) for auth.
- **Tailwind v4** (`@tailwindcss/vite`, tokens via `@theme`) + **`@product-suite/ui`**
  (the design system, seeded from `docs/design/tokens.css`).
- **Cloudflare** Workers Static Assets for hosting (`wrangler`).

## Commands

```bash
bun install                              # from the repo root
bun run --cwd apps/platform-web dev      # dev server on http://localhost:5180
bun run --cwd apps/platform-web typecheck
bun run --cwd apps/platform-web lint
bun run --cwd apps/platform-web test     # vitest + jsdom
bun run --cwd apps/platform-web build    # → dist/
# repo-root convenience: `bun run ci:platform-web` and `bun run test:ui`
```

## Environment

Copy `.env.example` → `.env.local` and set:

| Var | Purpose |
| --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_test_…` / `pk_live_…`). Without it the app boots to a setup notice; with it, sign-in works end-to-end. |
| `VITE_DEFAULT_WORKSPACE` | Default workspace slug for the post-sign-in redirect (`/w/<slug>`). Defaults to `befach-hq`. |

## Deploy (Cloudflare)

Hosted as a Workers Static Assets site (see [`wrangler.jsonc`](./wrangler.jsonc)).
The `Platform Web Deploy` GitHub workflow deploys production on push to `main`
and a versioned preview URL on PRs — but only once these repo secrets are set
(otherwise it skips and stays green):

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `VITE_CLERK_PUBLISHABLE_KEY` (build-time, for sign-in on the deployed preview)

Manual deploy: `bun run --cwd apps/platform-web deploy` (needs the Cloudflare env vars).

## Layout & the navigation law (DESIGN §2)

`src/shell/` holds the chrome: a left rail (workspace switcher → per-board
sidebar → board dock) and a main column (top bar → content `Outlet`). The
per-board sidebar is derived purely from the URL-derived active board
(`boards.ts`), so it **never mutates on content clicks** — only switching boards
(via the dock or `Cmd+1…5`) swaps it. Filters/views belong in the content area,
never the rail. `Cmd+K` opens the command palette.
