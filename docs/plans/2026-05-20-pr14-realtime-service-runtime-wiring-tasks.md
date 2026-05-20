# PR14 Realtime Service Runtime Wiring Tasks

Beads: `product-suite-36p`
Branch: `feat/pr14-realtime-service-runtime-wiring`

## Task 1: Register PR14 Runtime Planning State

OWNS: `docs/plans/building-blocks-transformation-pr-plan.md`, `test/repo-tooling.test.js`, `docs/research/pr14-realtime-service-runtime-wiring.md`, `docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-design.md`, `docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-tasks.md`

What to implement: mark PR13 merged and verified, add PR14 to the durable merge plan, and lock the new research/design/task artifacts with repo-tooling coverage.

TDD steps:
1. Update repo-tooling assertions to expect PR13 verified and PR14 active with all PR14 artifacts listed.
2. Run `bun run test:repo-tooling` and confirm failures before the plan document update.
3. Update the durable plan and PR14 artifacts.
4. Run `bun run test:repo-tooling` and confirm it passes.
5. Commit: `docs: plan pr14 realtime runtime wiring`

Expected output: the durable plan names PR14 as the active next slice and all PR14 artifacts are discoverable.

## Task 2: Add Hocuspocus Runtime Entrypoint

OWNS: `services/hocuspocus/package.json`, `services/hocuspocus/src/runtime.ts`, `services/hocuspocus/src/runtime.test.ts`, `services/hocuspocus/src/index.ts`

What to implement: add a service runtime entrypoint that validates environment config, constructs the service through the existing factory, and starts an injected server with `listen()`.

TDD steps:
1. Write failing runtime tests proving valid config calls `listen()` on an injected server and invalid config does not.
2. Run `bun run test:hocuspocus` and confirm failures.
3. Implement the minimal runtime wrapper and package `start` script.
4. Run `bun run test:hocuspocus` and confirm it passes.
5. Commit: `feat: add hocuspocus runtime entrypoint`

Expected output: `services/hocuspocus` can run as a service without weakening existing hook tests.

## Task 3: Add Health And Readiness Surface

OWNS: `services/hocuspocus/src/runtime.ts`, `services/hocuspocus/src/runtime.test.ts`, `services/hocuspocus/README.md`, `services/README.md`

What to implement: expose a minimal health/readiness helper or endpoint contract that reports service identity and runtime readiness without exposing secrets or document context.

TDD steps:
1. Write failing tests for healthy runtime status, pre-listen status, and redaction of sensitive inputs.
2. Run `bun run test:hocuspocus` and confirm failures.
3. Implement the readiness helper or endpoint contract.
4. Run `bun run test:hocuspocus` and confirm it passes.
5. Commit: `feat: add hocuspocus readiness contract`

Expected output: deployment smoke checks can verify the service is up without needing a canvas document.

## Task 4: Wire Roadmap Runtime Selection Without Cutover

OWNS: `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`, `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`, `apps/roadmap-web/.env.example`

What to implement: add a tested Roadmap config helper that selects a Hocuspocus realtime adapter only when service URL and token factory inputs are complete, while preserving the current Supabase Realtime fallback.

TDD steps:
1. Write failing Roadmap tests for configured Hocuspocus selection, missing URL fallback, and missing token factory fallback.
2. Run the focused canvas-boundary tests and confirm failures.
3. Implement the minimal config helper and env example notes without changing default behavior.
4. Run focused BlockSuite tests and `bun run --cwd apps/roadmap-web typecheck`.
5. Commit: `feat: prepare roadmap hocuspocus runtime selection`

Expected output: Roadmap can be pointed at the service runtime, but existing behavior remains stable by default.

## Task 5: Register Runtime Validation And CI Coverage

OWNS: `package.json`, `docs/VALIDATION.md`, `.github/workflows/repo-tooling-ci.yml`, `.github/workflows/roadmap-web-ci.yml`, `.github/workflows/roadmap-web-playwright.yml`, `test/repo-tooling.test.js`

What to implement: include runtime tests and runtime path filters in local validation docs and CI.

TDD steps:
1. Add failing repo-tooling assertions for the runtime script, validation docs, and workflow path filters.
2. Run `bun run test:repo-tooling` and confirm failures.
3. Update scripts/docs/workflows.
4. Run `bun run test:repo-tooling` and `bun run test:hocuspocus`.
5. Commit: `chore: validate hocuspocus runtime wiring`

Expected output: runtime changes are covered by focused service tests and repo-wide validation.

## Task 6: Validate And Ship PR14

OWNS: `docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-design.md`, `docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-tasks.md`, `docs/research/pr14-realtime-service-runtime-wiring.md`

What to implement: run focused and full validations, record evidence, push the branch, and open PR14.

TDD steps:
1. Run `bun run check:source-test`.
2. Run `bun run test:hocuspocus`, `bun run test:repo-tooling`, and focused Roadmap BlockSuite tests.
3. Run `bun run --cwd apps/roadmap-web typecheck`.
4. Run `bun run test:prepush`.
5. Ship PR14 with validation evidence.

Expected output: PR14 is open with runtime service tests, Roadmap selection coverage, repo-tooling validation, and full pre-push evidence.
