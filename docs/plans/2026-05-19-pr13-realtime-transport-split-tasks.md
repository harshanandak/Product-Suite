# PR13 Realtime Transport Split Tasks

Beads: `product-suite-6w3`
Branch: `feat/pr13-realtime-transport-split`

## Task 1: Register Hocuspocus Service Tooling

OWNS: `package.json`, `docs/VALIDATION.md`, `.github/workflows/repo-tooling-ci.yml`, `.github/workflows/roadmap-web-ci.yml`, `.github/workflows/roadmap-web-playwright.yml`, `test/repo-tooling.test.js`, `services/README.md`, `docs/plans/building-blocks-transformation-pr-plan.md`

What to implement: add `services/hocuspocus` to root workspaces, validation scripts, pre-push chain, docs, CI path filters, and durable PR plan state.

TDD steps:
1. Write failing repo-tooling assertions that `services/hocuspocus` appears in workspaces, validation scripts, validation docs, CI filters, services docs, and PR13 plan artifacts.
2. Run `bun run test:repo-tooling` and confirm the assertions fail.
3. Implement root script/docs/workflow updates.
4. Run `bun run test:repo-tooling` and confirm it passes.
5. Commit: `chore: register hocuspocus service`

Expected output: root tooling recognizes and validates the new realtime service boundary.

## Task 2: Define Service-Owned Collaboration Contracts

OWNS: `packages/ui-canvas/src/index.ts`, `packages/ui-canvas/src/index.test.ts`, `services/hocuspocus/package.json`, `services/hocuspocus/src/index.ts`, `services/hocuspocus/src/index.test.ts`

What to implement: extend canvas contracts with service-owned collaboration identity/config types and create `services/hocuspocus` exports for canonical room naming, token context, and runtime config validation.

TDD steps:
1. Write failing tests for valid room names, invalid identity rejection, and missing runtime config rejection.
2. Run `bun run test:ui-canvas` and `bun run --cwd services/hocuspocus test` and confirm failures before implementation.
3. Implement minimal contract exports and service helpers.
4. Run both focused test commands and confirm they pass.
5. Commit: `feat: add hocuspocus collaboration contracts`

Expected output: service-owned collaboration contracts exist without importing Roadmap or Supabase.

## Task 3: Build Injectable Hocuspocus Server Factory

OWNS: `services/hocuspocus/src/index.ts`, `services/hocuspocus/src/index.test.ts`

What to implement: add a typed Hocuspocus server factory that wires authentication, document load, document change, and document store hooks through injected dependencies.

TDD steps:
1. Write failing service tests for auth verifier delegation, load hook delegation, store hook delegation, and auth rejection.
2. Run `bun run --cwd services/hocuspocus test` and confirm failures before implementation.
3. Implement the server factory using `@hocuspocus/server` with typed context and injected hooks.
4. Run `bun run --cwd services/hocuspocus test` and confirm it passes.
5. Commit: `feat: add hocuspocus server factory`

Expected output: Hocuspocus runtime wiring is service-owned and testable without starting a deployed service.

## Task 4: Wire Roadmap Through Service-Owned Transport Config

OWNS: `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`, `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts`, `apps/roadmap-web/src/components/blocksuite/use-blocksuite-sync.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/hybrid-provider.test.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/use-blocksuite-sync.test.ts`

What to implement: move canonical realtime transport config and room naming behind service-owned contracts while preserving existing Supabase persistence, metadata updates, dirty-state handling, and explicit fallback behavior.

TDD steps:
1. Write failing Roadmap tests proving the app adapter consumes `services/hocuspocus` document naming/config and no longer hardcodes canonical room semantics locally.
2. Run focused BlockSuite tests and confirm failures before implementation.
3. Implement the thin Roadmap adapter and minimal provider wiring changes.
4. Run focused BlockSuite tests and `bun run --cwd apps/roadmap-web typecheck`.
5. Commit: `feat: route canvas realtime through hocuspocus boundary`

Expected output: Roadmap app shell delegates canonical transport semantics to the service boundary without changing canvas persistence behavior.

## Task 5: Validate And Ship PR13

OWNS: `docs/plans/2026-05-19-pr13-realtime-transport-split-design.md`, `docs/plans/2026-05-19-pr13-realtime-transport-split-tasks.md`, `docs/research/pr13-realtime-transport-split.md`

What to implement: run focused and full validations, record validation evidence, push the branch, and open PR13.

TDD steps:
1. Run `bun run check:source-test`.
2. Run `bun run test:ui-canvas`, `bun run --cwd services/hocuspocus test`, `bun run test:repo-tooling`, and focused Roadmap BlockSuite tests.
3. Run `bun run --cwd apps/roadmap-web typecheck`.
4. Run `bun run test:prepush`.
5. Commit any final docs-only validation evidence and ship PR.

Expected output: PR13 is open with service tests, Roadmap integration validation, repo-tooling validation, and full pre-push evidence.
