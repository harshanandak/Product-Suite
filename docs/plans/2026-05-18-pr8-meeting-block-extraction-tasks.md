# PR8 Meeting Block Extraction Tasks

## Task 1: Wire `packages/ui-meeting` Into The Repo

Files: `package.json`, `packages/ui-meeting/package.json`, CI workflows, `test/repo-tooling.test.js`

1. RED: Add repo-tooling expectations for `packages/ui-meeting` workspace and CI path filters.
2. GREEN: Add package metadata, root workspace wiring, and workflow path filters.
3. REFACTOR: Keep package naming and scripts consistent with existing internal packages.

Validation: `bun run test:repo-tooling`

## Task 2: Extract Meeting Summary Presentation

Files: `packages/ui-meeting/src/*`, `apps/meeting-web/src/components/meeting/SummaryFirstMeetingScreen.jsx`, package tests

1. RED: Add package tests for active meeting render, empty state, chooser state, slots, and helper exports.
2. GREEN: Implement `MeetingSummaryBlock` and helper exports in the shared package.
3. REFACTOR: Replace meeting-web summary wrapper internals with package import and shell slots.

Validation: `bun run --cwd packages/ui-meeting test`, `bun run --cwd apps/meeting-web test`

## Task 3: Add Roadmap Consumer

Files: `apps/roadmap-web/package.json`, `apps/roadmap-web/src/components/meetings/*`, roadmap tests

1. RED: Add a Roadmap component test proving a workspace meeting surface imports from `@product-suite/ui-meeting`.
2. GREEN: Add a minimal Roadmap meeting component that renders the shared block with local/sample data.
3. REFACTOR: Keep Roadmap-specific copy/data outside the shared package.

Validation: `bun run --cwd apps/roadmap-web test`, `bun run --cwd apps/roadmap-web typecheck`

## Task 4: Update Durable Plan Status

Files: `docs/plans/building-blocks-transformation-pr-plan.md`

1. RED: Update repo-tooling plan-status expectations from PR7 active to PR8 active.
2. GREEN: Mark PR7 merged and PR8 active with artifact links.
3. REFACTOR: Keep PR9+ status untouched.

Validation: `bun run test:repo-tooling`

## Task 5: Validate And Ship

1. Run focused package/app tests.
2. Run repo-tooling tests.
3. Run impacted app validation.
4. Commit, push, and open PR linked to `product-suite-613`.
