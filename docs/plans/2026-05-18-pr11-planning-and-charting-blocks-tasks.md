# PR11 Planning And Charting Blocks Tasks

Beads: `product-suite-w4r`
Branch: `feat/pr11-planning-and-charting-blocks`

## Task 1: Register Shared Planning And Charting Packages

OWNS: `package.json`, `docs/VALIDATION.md`, `.github/workflows/meeting-web-ci.yml`, `.github/workflows/roadmap-web-ci.yml`, `.github/workflows/roadmap-web-playwright.yml`, `.github/workflows/repo-tooling-ci.yml`, `test/repo-tooling.test.js`, `packages/README.md`

What to implement: add `packages/ui-planning` and `packages/ui-charting` to root workspaces, validation scripts, pre-push package checks, CI path filters, and documentation.

TDD steps:
1. Write failing repo-tooling assertions that both packages appear in workspaces, scripts, validation docs, and CI filters.
2. Run `bun run test:repo-tooling` and confirm the new assertions fail.
3. Implement root script/docs/workflow updates.
4. Run `bun run test:repo-tooling` and confirm it passes.
5. Commit: `chore: register planning and charting packages`

Expected output: root tooling recognizes and validates both new packages.

## Task 2: Build `@product-suite/ui-planning`

OWNS: `packages/ui-planning/package.json`, `packages/ui-planning/src/index.jsx`, `packages/ui-planning/src/index.d.ts`, `packages/ui-planning/src/index.test.jsx`

What to implement: create pure planning record types, grouping helpers, and SSR-safe planning presentation blocks that do not import Roadmap aliases or data clients.

TDD steps:
1. Write failing package tests for empty state rendering, work item rendering, timeline grouping, and non-mutating helper behavior.
2. Run `bun run --cwd packages/ui-planning test` and confirm it fails before implementation.
3. Implement minimal package exports.
4. Run `bun run --cwd packages/ui-planning test` and confirm it passes.
5. Commit: `feat: add shared planning ui package`

Expected output: `ui-planning` can render reusable planning summaries from plain props.

## Task 3: Build `@product-suite/ui-charting`

OWNS: `packages/ui-charting/package.json`, `packages/ui-charting/src/index.jsx`, `packages/ui-charting/src/index.d.ts`, `packages/ui-charting/src/index.test.jsx`

What to implement: create SSR-safe metric/trend presentation and pure chart datum helpers. Keep Recharts-heavy dashboard widgets in Roadmap unless a tiny wrapper can be package-owned without app aliases.

TDD steps:
1. Write failing package tests for metric rendering, trend formatting, empty chart data normalization, and non-mutating helper behavior.
2. Run `bun run --cwd packages/ui-charting test` and confirm it fails before implementation.
3. Implement minimal package exports.
4. Run `bun run --cwd packages/ui-charting test` and confirm it passes.
5. Commit: `feat: add shared charting ui package`

Expected output: `ui-charting` can render reusable metric cards and normalize chart data from plain props.

## Task 4: Consume Packages From Roadmap

OWNS: `apps/roadmap-web/package.json`, `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/_components/dashboard-view.tsx`, `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/_components/timeline-view.tsx`, `apps/roadmap-web/src/components/analytics/metric-card.tsx`, `apps/roadmap-web/src/components/analytics/__tests__/pr11-shared-packages.test.tsx`

What to implement: replace lower-risk local presentation/helpers with imports from `@product-suite/ui-planning` and `@product-suite/ui-charting`, while leaving Roadmap data fetching, route state, and shell wrappers in place.

TDD steps:
1. Write failing Roadmap tests proving package exports render through Roadmap integration and package imports exist.
2. Run the focused Roadmap tests and confirm they fail.
3. Implement minimal imports/wrappers.
4. Run focused Roadmap tests, then `bun run --cwd apps/roadmap-web typecheck`.
5. Commit: `feat: consume shared planning and charting blocks`

Expected output: Roadmap consumes both packages without moving persistence or routes.

## Task 5: Validate And Ship PR11

OWNS: `docs/plans/building-blocks-transformation-pr-plan.md`, `docs/plans/2026-05-18-pr11-planning-and-charting-blocks-design.md`, `docs/plans/2026-05-18-pr11-planning-and-charting-blocks-tasks.md`

What to implement: update durable plan state, run focused and full validations, push the branch, and create PR11.

TDD steps:
1. Run `bun run check:source-test`.
2. Run `bun run test:ui-planning`, `bun run test:ui-charting`, and `bun run test:repo-tooling`.
3. Run focused Roadmap tests and `bun run --cwd apps/roadmap-web typecheck`.
4. Run `bun run test:prepush`.
5. Commit any final docs-only state update and ship PR.

Expected output: PR11 is open with package tests, app validation, repo-tooling validation, and full pre-push evidence.
