# PR21 Single Domain Platform Shell Research

Date: 2026-06-08
Branch: `feat/pr21-single-domain-platform-shell`
Beads: `product-suite-a49`

## Scope

PR21 makes Product Suite feel like one authenticated product surface after PR18-PR20 established Clerk/auth contracts, the unified Supabase schema direction, and the Meeting database cutover. The shell should expose Meeting, Roadmap, Canvas, Agents, and Settings as modules under one route model while preserving module ownership and validation boundaries.

## Existing plan inputs

- `docs/plans/building-blocks-transformation-pr-plan.md` defines PR21 as `Single Domain Platform Shell`.
- `docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md` says the product shape should be `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings` under one domain and one shell.
- `docs/plans/2026-05-31-pr18-clerk-auth-foundation-design.md` defines the future platform auth boundary: root provider, protected route matchers, callback ownership, and redirect intent.
- `docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-design.md` keeps platform identity and module schema ownership explicit.
- `docs/plans/2026-06-03-pr20-meeting-database-cutover-from-neon-to-supabase-design.md` moves Meeting persistence toward Supabase while preserving Meeting API ownership.

## Current app-shell baseline

Roadmap is the strongest candidate for the Product Suite host because it is already a Next.js App Router app:

- `apps/roadmap-web/src/app/layout.tsx` owns the HTML/body root and shared `Providers`.
- `apps/roadmap-web/src/app/providers.tsx` owns React Query, command palette, and toast infrastructure.
- `apps/roadmap-web/src/middleware.ts` currently refreshes Supabase auth and canonical auth session state for matched routes.
- `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/canvas/*` already gives Canvas a route family inside Roadmap.
- `apps/roadmap-web/src/components/meetings/workspace-meeting-surface.tsx` already proves Roadmap can consume the shared `@product-suite/ui-meeting` package.

Meeting remains a Vite/React Router app:

- `apps/meeting-web/src/main.jsx` creates a `createBrowserRouter(createAppRouter())` router.
- `apps/meeting-web/src/app/router.jsx` defines `/`, `/auth/*`, `/app`, `/meetings`, `/meetings/new`, and `/meetings/:meetingId`.
- `apps/meeting-web/src/pages/MeetingRoutePage.jsx` already lazy-loads the heavy workspace app and wraps it in an error boundary.
- `apps/meeting-web/src/lib/hostedAuthRoutes.js` stores and sanitizes post-login paths for Meeting-specific auth redirects.

## Route ownership matrix

| Target route | Owner after PR21 | Current source | Notes |
| --- | --- | --- | --- |
| `/` | platform shell | `apps/roadmap-web/src/app/page.tsx` and Meeting landing | Should become the Product Suite entry, not a module-specific website. |
| `/meetings` | platform shell route, Meeting module content | `apps/meeting-web/src/app/router.jsx` and `@product-suite/ui-meeting` | PR21 should mount a shell-native Meeting module entry. Full Vite runtime merge is out of scope. |
| `/meetings/new` | platform shell route, Meeting module content | `apps/meeting-web/src/app/router.jsx` | Preserve intent and route ownership even if the initial UI is a shell-hosted entrypoint. |
| `/meetings/:meetingId` | platform shell route, Meeting module content | `apps/meeting-web/src/app/router.jsx` | Keep Meeting API as data owner. |
| `/roadmap` | platform shell route | Roadmap dashboard/workspace routes | Should point users into Roadmap without changing existing workspace URL semantics. |
| `/canvas` | platform shell route | Roadmap workspace canvas routes and `packages/ui-canvas` | PR21 reserves the top-level module path and links to workspace-scoped canvas. |
| `/agents` | platform shell route | `services/agent-core` and Roadmap AI routes | PR21 shell entry only; agent permissions/runtime hardening is PR22+. |
| `/settings` | platform shell route | Roadmap profile/team/settings routes | Platform settings entry should not rewrite all module settings in this PR. |
| `/auth/*` | platform auth boundary | Roadmap canonical auth and Meeting hosted auth routes | PR21 must avoid auth redirect loops while route prefixes change. |
| Existing Roadmap workspace routes | Roadmap module | `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/*` | Preserve for bookmarks and current tests. |
| Existing Meeting Vite routes | Meeting module / compatibility | `apps/meeting-web/src/app/router.jsx` | Keep Meeting validation separate and document compatibility. |

## External guidance

- Next.js App Router supports route groups and nested layouts for section-specific UI, but navigation across multiple root layouts triggers a full-page load. PR21 should use one root shell layout for platform modules instead of multiple root layouts when module switching should feel like one product. Source: Context7 `/vercel/next.js`, Next.js layout docs.
- Next.js supports `loading.tsx` and `error.tsx` route-level boundaries in the App Router. PR21 should add boundaries around module routes so one module load failure does not break the shell. Source: Context7 `/vercel/next.js`, App Router docs.
- Next.js redirects can be declared in `next.config.ts` with wildcard source/destination pairs. PR21 should use explicit redirects or shell-level compatibility routes for old top-level paths rather than accidental route shadowing. Source: Context7 `/vercel/next.js`, redirecting docs.
- React Router `basename` strips the configured prefix during matching and prepends it for generated links. If Meeting stays independently deployable, it can be configured for `/meetings` without rewriting all route definitions. Source: Context7 `/remix-run/react-router`, basename docs.
- React Router route objects support `lazy` route modules and error boundaries through data-router configuration. Existing Meeting lazy loading should be preserved if the Vite app remains a compatibility runtime. Source: Context7 `/remix-run/react-router`, lazy route module docs.
- Clerk's Next.js App Router guidance places `ClerkProvider` at the root layout and uses `clerkMiddleware` with explicit public route matchers and `auth.protect()` for protected routes. PR21 should align shell route protection with the PR18 auth contract rather than invent a second auth boundary. Source: Context7 `/clerk/clerk-docs`, Clerk Next.js middleware docs.

## Approach options

1. Full runtime merge: import Meeting Vite app directly into Roadmap/Next routes.
   - Pros: fastest path to a literal one-app runtime.
   - Cons: high risk from Vite-specific CSS, browser-only code, React Router assumptions, and existing Meeting auth/runtime config.

2. Shell-native module facade: make Roadmap/Next the platform host, add module registry/app switcher/routes, and mount Meeting through shared package surfaces and shell-owned route entries while preserving Meeting Vite validation separately.
   - Pros: mergeable, testable, keeps module boundaries explicit, and fits existing shared-package work.
   - Cons: not every Meeting screen is fully migrated in one PR.

3. Reverse host: make Meeting/Vite host Product Suite and link/proxy Roadmap.
   - Pros: Meeting already has an app-shell UI.
   - Cons: loses Next App Router/server route ownership, Roadmap API routes, middleware, and current platform auth/session surface.

Recommended: option 2. It satisfies the PR21 goal of one Product Suite shell and module navigation while keeping Meeting API, Roadmap API, canvas, and agent runtime boundaries intact. Full Meeting runtime consolidation can be a later implementation if route ownership and conversion data prove it is needed.

## Safety requirements

- Keep the module registry metadata-only. It must not import module runtime bundles.
- Lazy-load module content and add module route loading/error boundaries.
- Preserve old Roadmap workspace routes and Meeting compatibility routes through an explicit route ownership matrix.
- Keep auth redirect handling centralized. Do not create a second Meeting-only login flow inside the platform shell.
- Keep Meeting API and Roadmap API ownership unchanged.
- Keep validation separate: Roadmap shell tests, Meeting web tests, repo tooling, and source-test coupling must all remain green.

## TDD scenarios

1. Repo-tooling test fails until PR21 research, design, decisions, and task files exist and the building-blocks plan marks PR20 verified with PR21 active.
2. Module registry unit test fails until `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings` are defined with metadata-only records and no runtime component imports.
3. Platform shell rendering test fails until an app switcher renders all module links and marks the active module.
4. Route ownership test fails until old Meeting/Roadmap paths and new platform module paths have explicit owners and compatibility behavior.
5. Roadmap route test fails until `/meetings` renders a shell-hosted Meeting module entry without importing the Vite `App`.
6. Error-boundary test fails until a module load failure renders a module-scoped fallback instead of breaking the whole shell.
7. Auth-routing test fails until protected module paths preserve return intent and public auth paths do not redirect-loop.
