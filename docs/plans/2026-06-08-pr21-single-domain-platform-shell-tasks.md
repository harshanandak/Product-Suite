# PR21 Single Domain Platform Shell Tasks

Feature: `pr21-single-domain-platform-shell`
Date: 2026-06-08
Beads: `product-suite-a49`

## Task 1: Durable Plan And Sequence Guard

File(s): `docs/research/pr21-single-domain-platform-shell.md`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-*.md`, `docs/plans/building-blocks-transformation-pr-plan.md`, `test/repo-tooling.test.js`

OWNS: `docs/research/pr21-single-domain-platform-shell.md`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-design.md`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-decisions.md`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-tasks.md`, `docs/plans/building-blocks-transformation-pr-plan.md`, `test/repo-tooling.test.js`

What to implement: Update the durable planning state so PR20 is marked merged/verified, PR21 is active, and PR21 research/design/decisions/tasks are enforced by repo-tooling tests.

TDD steps:
1. Write test: extend `test/repo-tooling.test.js` so it fails until PR21 artifact paths exist and the building-blocks plan points to them.
2. Run test: `bun test test/repo-tooling.test.js`; expected failure mentions missing PR21 artifacts or status text.
3. Implement: add/adjust PR21 planning docs and current-status text.
4. Run test: `bun test test/repo-tooling.test.js`; expected pass.
5. Commit: `docs: plan pr21 single domain platform shell`

Expected output: repo-tooling validates the PR21 plan state from the current branch.

## Task 2: Metadata-Only Module Registry

File(s): `apps/roadmap-web/src/lib/platform/module-registry.ts`, `apps/roadmap-web/src/lib/platform/__tests__/module-registry.test.ts`

OWNS: `apps/roadmap-web/src/lib/platform/module-registry.ts`, `apps/roadmap-web/src/lib/platform/__tests__/module-registry.test.ts`

What to implement: Add a shell-owned module registry for Meeting, Roadmap, Canvas, Agents, and Settings with stable IDs, labels, hrefs, status metadata, active-route resolution, and no runtime component imports.

TDD steps:
1. Write test: assert the registry contains `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings`; assert active module resolution for nested paths; assert source text does not import module UI components.
2. Run test: `bun run --cwd apps/roadmap-web test src/lib/platform/__tests__/module-registry.test.ts`; expected failure is missing module registry.
3. Implement: create `module-registry.ts` with metadata records and helper functions.
4. Run test: same command; expected pass.
5. Commit: `feat: add platform module registry`

Expected output: module metadata can drive navigation without loading module runtimes.

## Task 3: Platform Shell And App Switcher

File(s): `apps/roadmap-web/src/components/platform/platform-shell.tsx`, `apps/roadmap-web/src/components/platform/module-switcher.tsx`, `apps/roadmap-web/src/components/platform/__tests__/platform-shell.test.tsx`

OWNS: `apps/roadmap-web/src/components/platform/platform-shell.tsx`, `apps/roadmap-web/src/components/platform/module-switcher.tsx`, `apps/roadmap-web/src/components/platform/__tests__/platform-shell.test.tsx`

What to implement: Add a testable shell wrapper that renders module navigation, active state, reserved/disabled module states, and page content without backend calls.

TDD steps:
1. Write test: render the shell with the registry and assert all module links, active state, and disabled/reserved affordances.
2. Run test: `bun run --cwd apps/roadmap-web test src/components/platform/__tests__/platform-shell.test.tsx`; expected failure is missing component.
3. Implement: create shell and switcher components using existing Roadmap UI primitives where practical.
4. Run test: same command; expected pass.
5. Commit: `feat: add platform shell switcher`

Expected output: shell UI can be reused by all module routes.

## Task 4: Route Ownership Matrix And Compatibility Contract

File(s): `apps/roadmap-web/src/lib/platform/route-ownership.ts`, `apps/roadmap-web/src/lib/platform/__tests__/route-ownership.test.ts`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-decisions.md`

OWNS: `apps/roadmap-web/src/lib/platform/route-ownership.ts`, `apps/roadmap-web/src/lib/platform/__tests__/route-ownership.test.ts`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-decisions.md`

What to implement: Encode the PR21 route ownership matrix for new platform paths, preserved Roadmap paths, Meeting compatibility paths, and auth-only paths.

TDD steps:
1. Write test: assert each target path has an owner, compatibility behavior, and module ID where applicable.
2. Run test: `bun run --cwd apps/roadmap-web test src/lib/platform/__tests__/route-ownership.test.ts`; expected failure is missing route ownership contract.
3. Implement: create `route-ownership.ts` and update the decisions log with any compatibility choices.
4. Run test: same command; expected pass.
5. Commit: `feat: define platform route ownership`

Expected output: route compatibility is machine-checkable instead of only described in prose.

## Task 5: Shell-Native Module Routes

File(s): `apps/roadmap-web/src/app/(platform)/meetings/page.tsx`, `apps/roadmap-web/src/app/(platform)/roadmap/page.tsx`, `apps/roadmap-web/src/app/(platform)/canvas/page.tsx`, `apps/roadmap-web/src/app/(platform)/agents/page.tsx`, `apps/roadmap-web/src/app/(platform)/settings/page.tsx`, `apps/roadmap-web/src/app/(platform)/layout.tsx`, `apps/roadmap-web/src/app/(platform)/__tests__/platform-routes.test.tsx`

OWNS: `apps/roadmap-web/src/app/(platform)/meetings/page.tsx`, `apps/roadmap-web/src/app/(platform)/roadmap/page.tsx`, `apps/roadmap-web/src/app/(platform)/canvas/page.tsx`, `apps/roadmap-web/src/app/(platform)/agents/page.tsx`, `apps/roadmap-web/src/app/(platform)/settings/page.tsx`, `apps/roadmap-web/src/app/(platform)/layout.tsx`, `apps/roadmap-web/src/app/(platform)/__tests__/platform-routes.test.tsx`

What to implement: Add module-prefixed Next routes under one shell layout. Meeting should render a shell-hosted Meeting module entry using shared meeting surfaces; Roadmap/Canvas/Agents/Settings should expose clear shell entries without rewriting existing workspace routes.

TDD steps:
1. Write test: render each route entry and assert shell title/module content; assert `/meetings` does not import `apps/meeting-web/src/App.jsx`.
2. Run test: `bun run --cwd apps/roadmap-web test src/app/(platform)/__tests__/platform-routes.test.tsx`; expected failure is missing routes.
3. Implement: add platform route group layout and module pages.
4. Run test: same command; expected pass.
5. Commit: `feat: add platform module routes`

Expected output: users can navigate to the reserved module paths from the Next shell.

## Task 6: Module Loading And Error Boundaries

File(s): `apps/roadmap-web/src/app/(platform)/loading.tsx`, `apps/roadmap-web/src/app/(platform)/error.tsx`, `apps/roadmap-web/src/components/platform/module-boundary.tsx`, `apps/roadmap-web/src/components/platform/__tests__/module-boundary.test.tsx`

OWNS: `apps/roadmap-web/src/app/(platform)/loading.tsx`, `apps/roadmap-web/src/app/(platform)/error.tsx`, `apps/roadmap-web/src/components/platform/module-boundary.tsx`, `apps/roadmap-web/src/components/platform/__tests__/module-boundary.test.tsx`

What to implement: Add module-scoped loading and failure UI so one module load issue does not break the whole shell.

TDD steps:
1. Write test: simulate a module child throwing and assert a scoped fallback with retry guidance.
2. Run test: `bun run --cwd apps/roadmap-web test src/components/platform/__tests__/module-boundary.test.tsx`; expected failure is missing boundary.
3. Implement: add boundary component plus App Router `loading.tsx`/`error.tsx`.
4. Run test: same command; expected pass.
5. Commit: `feat: isolate platform module loading states`

Expected output: module route failures stay local to the module content area.

## Task 7: Auth Route Compatibility

File(s): `apps/roadmap-web/src/lib/platform/auth-route-compatibility.ts`, `apps/roadmap-web/src/lib/platform/__tests__/auth-route-compatibility.test.ts`, `apps/roadmap-web/src/middleware.test.ts`, `apps/roadmap-web/src/middleware.ts`

OWNS: `apps/roadmap-web/src/lib/platform/auth-route-compatibility.ts`, `apps/roadmap-web/src/lib/platform/__tests__/auth-route-compatibility.test.ts`, `apps/roadmap-web/src/middleware.test.ts`, `apps/roadmap-web/src/middleware.ts`

What to implement: Add route helpers and middleware coverage so protected module paths preserve same-origin return intent and public/auth-only paths do not loop.

TDD steps:
1. Write test: assert `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings` are protected return-intent candidates; assert `/auth/*` paths are public/auth-only and never stored as post-login targets.
2. Run test: `bun run --cwd apps/roadmap-web test src/lib/platform/__tests__/auth-route-compatibility.test.ts src/middleware.test.ts`; expected failure is missing compatibility helper or middleware wiring.
3. Implement: add helper and wire middleware only as needed to preserve current canonical auth behavior.
4. Run test: same command; expected pass.
5. Commit: `feat: preserve platform auth route intent`

Expected output: PR21 route changes do not create auth loops or lost return paths.

## Task 8: Meeting Compatibility And Validation Handoff

File(s): `apps/meeting-web/src/app/router.jsx`, `apps/meeting-web/src/__tests__/routingPages.test.jsx`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-decisions.md`, `docs/deployment/SERVICE_INVENTORY.md`

OWNS: `apps/meeting-web/src/app/router.jsx`, `apps/meeting-web/src/__tests__/routingPages.test.jsx`, `docs/plans/2026-06-08-pr21-single-domain-platform-shell-decisions.md`, `docs/deployment/SERVICE_INVENTORY.md`

What to implement: Keep Meeting independently valid while documenting how its routes relate to the new shell. If needed, configure/test Meeting routes so they can run under a `/meetings` basename without breaking local standalone usage.

TDD steps:
1. Write test: assert Meeting route definitions remain valid for standalone use and document `/meetings` compatibility.
2. Run test: `bun run --cwd apps/meeting-web test src/__tests__/routingPages.test.jsx`; expected failure if compatibility metadata is missing.
3. Implement: add route compatibility metadata or basename support without rewriting Meeting runtime ownership.
4. Run test: same command; expected pass.
5. Commit: `test: preserve meeting route compatibility`

Expected output: Meeting remains a separately validated deployable while the platform shell owns the user-facing module entry.

## Validation Priorities

- `bun run test:repo-tooling`
- `bun run --cwd apps/roadmap-web test src/lib/platform src/components/platform src/app/(platform) src/middleware.test.ts`
- `bun run --cwd apps/meeting-web test src/__tests__/routingPages.test.jsx`
- `bun run check:source-test`
- `bun run ci:roadmap-web`
- `bun run ci:meeting-web`
- `bun run test:prepush`

