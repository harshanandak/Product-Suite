# PR16 Hocuspocus Provider Controlled Rollout Tasks

Feature: `pr16-hocuspocus-provider-controlled-rollout`
Beads: `product-suite-bc8`

## Task 1: Add Explicit Hocuspocus Rollout Gate

OWNS: `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`, `apps/roadmap-web/.env.example`

What to implement: require an explicit Roadmap rollout flag in addition to URL, token factory, and provider factory before selecting Hocuspocus.

TDD steps:
1. Write failing tests proving missing flag, missing URL, and missing token factory keep Supabase fallback active.
2. Run `bun run test:roadmap-canvas-boundary` and confirm failure.
3. Add the minimal rollout flag parsing and selection guard.
4. Run `bun run test:roadmap-canvas-boundary`.

Expected output: Hocuspocus cannot half-enable from partial config.

## Task 2: Instrument Provider Lifecycle Without Token Leakage

OWNS: `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`

What to implement: map provider status, authentication, authentication failure, sync, and disconnect events into existing connection and sync error callbacks without logging token values.

TDD steps:
1. Write failing tests for connected, disconnected, authenticated, authentication failed, synced, and disconnect callbacks.
2. Run `bun run test:roadmap-canvas-boundary` and confirm failure.
3. Add minimal lifecycle mapping.
4. Run focused tests and `bun run --cwd apps/roadmap-web typecheck`.

Expected output: rollout behavior is inspectable through existing callbacks.

## Task 3: Prove Service/Client Token Context Alignment

OWNS: `services/hocuspocus/src/index.test.ts`, `services/hocuspocus/src/index.ts`

What to implement: strengthen service tests around verified token context, document name matching, read-only marking, and write denial.

TDD steps:
1. Write failing service tests for mismatched document context and read-only write denial.
2. Run `bun run --cwd services/hocuspocus test` and confirm failure if coverage is missing.
3. Implement only the missing service guard behavior.
4. Run `bun run --cwd services/hocuspocus test`.

Expected output: Hocuspocus auth context cannot authorize the wrong canvas document.

## Task 4: Document Rollback And Validation

OWNS: `docs/VALIDATION.md`, `docs/plans/building-blocks-transformation-pr-plan.md`, `test/repo-tooling.test.js`

What to implement: document the rollout flag rollback path and update durable planning state.

TDD steps:
1. Update `test/repo-tooling.test.js` first to expect PR15 verified and PR16 active.
2. Run `bun run test:repo-tooling` and confirm failure.
3. Update docs and durable plan state.
4. Run `bun run test:repo-tooling`.

Expected output: project state points to PR16 and operators have a clear rollback path.

## Validation Before Ship

1. `bun run check:source-test`
2. `bun run test:roadmap-canvas-boundary`
3. `bun run --cwd services/hocuspocus test`
4. `bun run --cwd apps/roadmap-web typecheck`
5. `bun run test:repo-tooling`
6. `bun run test:prepush`
