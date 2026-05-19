# PR12 Agent-Core Service Tasks

Beads: `product-suite-4xw`
Branch: `feat/pr12-agent-core-service`

## Task 1: Register Agent-Core Service Tooling

OWNS: `package.json`, `docs/VALIDATION.md`, `.github/workflows/repo-tooling-ci.yml`, `.github/workflows/roadmap-web-ci.yml`, `.github/workflows/roadmap-web-playwright.yml`, `test/repo-tooling.test.js`, `services/README.md`, `docs/plans/building-blocks-transformation-pr-plan.md`

What to implement: add `services/agent-core` to root workspaces, validation scripts, pre-push chain, docs, CI path filters, and durable PR plan state.

TDD steps:
1. Write failing repo-tooling assertions that `services/agent-core` appears in workspaces, scripts, validation docs, CI filters, and PR12 plan artifacts.
2. Run `bun run test:repo-tooling` and confirm the new assertions fail.
3. Implement root script/docs/workflow updates.
4. Run `bun run test:repo-tooling` and confirm it passes.
5. Commit: `chore: register agent-core service`

Expected output: root tooling recognizes and validates the new service boundary.

## Task 2: Build Injectable Agent-Core Executor

OWNS: `services/agent-core/package.json`, `services/agent-core/src/index.ts`, `services/agent-core/src/index.test.ts`

What to implement: create a service-owned task-plan executor with injected tool execution, retry, cancellation, timeout, progress callbacks, and result aggregation. Do not import Roadmap aliases or Supabase.

TDD steps:
1. Write failing tests for completed multi-step execution, retry failure, cancellation, and timeout.
2. Run `bun run --cwd services/agent-core test` and confirm failures before implementation.
3. Implement the minimal executor and exported types.
4. Run `bun run --cwd services/agent-core test` and confirm it passes.
5. Commit: `feat: add agent-core executor service`

Expected output: agent-core can execute task plans deterministically from injected dependencies.

## Task 3: Wire Roadmap Agent Loop Through Agent-Core

OWNS: `apps/roadmap-web/src/lib/ai/agent-core-adapter.ts`, `apps/roadmap-web/src/lib/ai/agent-core-adapter.test.ts`, `apps/roadmap-web/src/lib/ai/agent-loop.ts`, `apps/roadmap-web/src/lib/ai/agent-loop.test.ts`

What to implement: add a Roadmap adapter that resolves tools through the existing `toolRegistry`, delegates task-plan execution to `services/agent-core`, and preserves the current `agent-loop` public exports used by routes.

TDD steps:
1. Write failing adapter tests proving Roadmap delegates ordered execution to `services/agent-core` while resolving tools through a stub registry.
2. Run the focused Roadmap tests and confirm they fail before implementation.
3. Implement the adapter and compatibility wrapper.
4. Run focused Roadmap tests and `bun run --cwd apps/roadmap-web typecheck`.
5. Commit: `feat: delegate roadmap agent loop to agent-core`

Expected output: existing Roadmap imports keep working while orchestration policy is service-owned.

## Task 4: Preserve Route Behavior Through Integration Tests

OWNS: `apps/roadmap-web/src/app/api/ai/agent/plan/approve/route.ts`, `apps/roadmap-web/src/app/api/ai/agent/plan/approve/route.test.ts`

What to implement: keep route-level auth, plan approval, SSE progress, cancellation map, and response shape in Roadmap while proving plan execution still flows through the adapter.

TDD steps:
1. Write failing route-level tests or source-level integration assertions for imports and response/progress behavior.
2. Run focused tests and confirm failures before implementation.
3. Update imports/wiring only as needed.
4. Run focused tests and `bun run --cwd apps/roadmap-web typecheck`.
5. Commit: `test: lock agent-core route integration`

Expected output: route behavior remains stable while execution policy comes from agent-core.

## Task 5: Validate And Ship PR12

OWNS: `docs/plans/2026-05-19-pr12-agent-core-service-design.md`, `docs/plans/2026-05-19-pr12-agent-core-service-tasks.md`, `docs/research/pr12-agent-core-service.md`

What to implement: run focused and full validations, record validation evidence, push the branch, and open PR12.

TDD steps:
1. Run `bun run check:source-test`.
2. Run `bun run test:agent-core`, `bun run test:repo-tooling`, and focused Roadmap agent tests.
3. Run `bun run --cwd apps/roadmap-web typecheck`.
4. Run `bun run test:prepush`.
5. Commit any final docs-only validation evidence and ship PR.

Expected output: PR12 is open with agent-core tests, Roadmap integration validation, repo-tooling validation, and full pre-push evidence.
