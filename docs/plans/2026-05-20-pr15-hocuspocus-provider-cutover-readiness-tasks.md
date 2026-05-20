# PR15 Hocuspocus Provider Cutover Readiness Tasks

Feature: `pr15-hocuspocus-provider-cutover-readiness`
Beads: `product-suite-yo0`

## Task 1: Extend Canvas Realtime Contract For Document-Aware Providers

OWNS: `packages/ui-canvas/src/index.ts`, `packages/ui-canvas/src/index.test.ts`

What to implement: add a document binding option to the shared realtime connect contract without importing Yjs as a runtime dependency into `packages/ui-canvas`.

TDD steps:
1. Write a failing `ui-canvas` test proving realtime adapters can receive an optional document reference.
2. Run `bun run --cwd packages/ui-canvas test` and confirm failure.
3. Implement the minimal type/interface change.
4. Run `bun run --cwd packages/ui-canvas test` and confirm it passes.

Expected output: canvas realtime boundaries can support provider-native sync while remaining shell-agnostic.

## Task 2: Pass Yjs Document Through HybridProvider

OWNS: `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/hybrid-provider.test.ts`

What to implement: pass the active Yjs document into `realtime.connect` and preserve the existing Supabase broadcast path.

TDD steps:
1. Write a failing HybridProvider test proving the realtime adapter receives the exact Yjs document instance.
2. Run focused BlockSuite tests and confirm failure.
3. Pass the document through the realtime connect call.
4. Run focused BlockSuite tests and `bun run --cwd apps/roadmap-web typecheck`.

Expected output: document-native providers have the required input without changing fallback behavior.

## Task 3: Add Roadmap Hocuspocus Provider Connection Factory

OWNS: `apps/roadmap-web/package.json`, `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`

What to implement: add a Roadmap-owned Hocuspocus provider connection factory that can construct a provider from URL, document name, token, handlers, and Yjs document.

TDD steps:
1. Write failing tests for provider construction inputs, status mapping, authentication failure handling, and destroy cleanup.
2. Run `bun run test:roadmap-canvas-boundary` and confirm failure.
3. Add the provider dependency and minimal factory implementation.
4. Run `bun run test:roadmap-canvas-boundary` and `bun run --cwd apps/roadmap-web typecheck`.

Expected output: Roadmap has a real provider factory behind the existing explicit selection gate.

## Task 4: Add Token Factory Boundary Without Auth Semantics Change

OWNS: `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`, `apps/roadmap-web/.env.example`

What to implement: add a tested token factory boundary that is explicit, non-empty, and does not change canonical auth semantics.

TDD steps:
1. Write failing tests for missing token, empty token, and successful token forwarding.
2. Run focused Roadmap tests and confirm failure.
3. Implement the minimal token factory wiring and environment notes.
4. Run focused Roadmap tests and typecheck.

Expected output: Hocuspocus activation remains fail-closed and explicit.

## Task 5: Update Durable Plan And Validation Guardrails

OWNS: `docs/plans/building-blocks-transformation-pr-plan.md`, `docs/VALIDATION.md`, `test/repo-tooling.test.js`

What to implement: mark PR14 merged and verified, add PR15 active artifacts, and ensure repo-tooling tests prevent stale plan state.

TDD steps:
1. Update `test/repo-tooling.test.js` first to expect PR14 verified and PR15 active.
2. Run `bun run test:repo-tooling` and confirm failure.
3. Update durable docs and validation notes.
4. Run `bun run test:repo-tooling`.

Expected output: project state points to the actual next slice.

## Validation Before Ship

1. `bun run check:source-test`
2. `bun run --cwd packages/ui-canvas test`
3. `bun run test:roadmap-canvas-boundary`
4. `bun run --cwd apps/roadmap-web typecheck`
5. `bun run test:repo-tooling`
6. `bun run test:prepush`
