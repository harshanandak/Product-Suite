# PR4 Contracts Nucleus Tasks

## Task 1: Wire `packages/contracts` Into The Repo
File(s): `package.json`, `packages/contracts/package.json`, `packages/contracts/README.md`
OWNS: `package.json`, `packages/contracts/package.json`, `packages/contracts/README.md`
What to implement: add truthful workspace/package wiring so `packages/contracts` exists as a first-class internal package and can be imported by both JS apps.
TDD steps:
1. Write test: extend `test/repo-tooling.test.js` to assert the root workspace list and root scripts acknowledge `packages/contracts`.
2. Run test: confirm it fails because the package is not wired yet.
3. Implement: add the package manifest, include the package in the root workspace configuration, and document its purpose.
4. Run test: confirm the repo tooling guard passes.
5. Commit: `test: guard contracts package wiring`
Expected output: root tooling tests recognize `packages/contracts` as a real shared package target.

## Task 2: Add The Contracts Package Nucleus
File(s): `packages/contracts/src/index.ts`, `packages/contracts/src/identity.ts`, `packages/contracts/src/conversation.ts`, `packages/contracts/src/meeting.ts`, `packages/contracts/src/canvas.ts`
OWNS: `packages/contracts/src/index.ts`, `packages/contracts/src/identity.ts`, `packages/contracts/src/conversation.ts`, `packages/contracts/src/meeting.ts`, `packages/contracts/src/canvas.ts`
What to implement: add the first minimal contract exports for identity scope, conversation, meeting core, and canvas core without adding app-local task/workflow/webhook shapes.
TDD steps:
1. Write test: add a package-focused unit/guard test that asserts the four contract modules exist and export the expected nuclei.
2. Run test: confirm it fails because the package exports do not exist yet.
3. Implement: add the contracts source files and a single public entrypoint.
4. Run test: confirm the contracts export surface passes.
5. Commit: `feat: add contracts package nucleus`
Expected output: one public contracts package exposes four narrow wire-contract modules.

## Task 3: Make The Contracts Honest For Cross-Language Use
File(s): `packages/contracts/contracts/*.json`, `apps/meeting-api/tests/backend/test_runtime_payload.py`
OWNS: `packages/contracts/contracts/*.json`, `apps/meeting-api/tests/backend/test_runtime_payload.py`
What to implement: store a serializable contract artifact alongside the TS-friendly exports and make the backend test suite validate runtime payload shape against that same artifact instead of a parallel hand-written expectation.
TDD steps:
1. Write test: tighten the backend runtime-payload test to load the canonical contract artifact from `packages/contracts`.
2. Run test: confirm it fails because no canonical artifact exists yet.
3. Implement: add the artifact files and backend test helper usage.
4. Run test: confirm backend contract validation passes.
5. Commit: `test: validate backend runtime payload against shared contracts`
Expected output: Python tests consume the same canonical contracts artifact as the JS apps.

## Task 4: Adopt Identity And Meeting Contracts In Meeting Web
File(s): `apps/meeting-web/src/lib/api.js`, `apps/meeting-web/src/lib/runtimeConfig.js`, `apps/meeting-web/src/lib/__tests__/api.test.js`, `apps/meeting-web/src/lib/__tests__/runtimeConfig.test.js`
OWNS: `apps/meeting-web/src/lib/api.js`, `apps/meeting-web/src/lib/runtimeConfig.js`, `apps/meeting-web/src/lib/__tests__/api.test.js`, `apps/meeting-web/src/lib/__tests__/runtimeConfig.test.js`
What to implement: replace duplicated runtime/auth/meeting wire-shape assumptions in meeting-web with imports from `packages/contracts`.
TDD steps:
1. Write test: update meeting-web runtime/api tests to assert contract-driven field access and naming.
2. Run test: confirm it fails on the old local shape assumptions.
3. Implement: adopt the shared identity and meeting contract helpers in meeting-web.
4. Run test: confirm meeting-web tests pass.
5. Commit: `refactor: adopt shared contracts in meeting web`
Expected output: meeting-web stops defining its own divergent runtime payload assumptions.

## Task 5: Adopt Conversation And Canvas Contracts In Roadmap
File(s): `apps/roadmap-web/src/lib/supabase/types.ts`, `apps/roadmap-web/src/components/blocksuite/**`, `apps/roadmap-web/src/**/*.test.*`
OWNS: `apps/roadmap-web/src/lib/supabase/types.ts`, `apps/roadmap-web/src/components/blocksuite/**`, `apps/roadmap-web/src/**/*.test.*`
What to implement: use the shared conversation and canvas contract nucleus only where roadmap currently exposes wire-level chat thread/message or blocksuite document shapes.
TDD steps:
1. Write test: add or tighten roadmap tests around chat/canvas contract usage.
2. Run test: confirm it fails before adoption.
3. Implement: import the shared contract helpers without replacing roadmap’s domain-local schema ownership.
4. Run test: confirm roadmap unit tests pass.
5. Commit: `refactor: adopt shared contracts in roadmap`
Expected output: roadmap uses shared wire contracts where appropriate but retains local schema truth.

## Task 6: Guard The Boundary And Validation Story
File(s): `test/repo-tooling.test.js`, `docs/VALIDATION.md`, `.github/workflows/repo-tooling-ci.yml`
OWNS: `test/repo-tooling.test.js`, `docs/VALIDATION.md`, `.github/workflows/repo-tooling-ci.yml`
What to implement: lock down the PR4 boundary so the contracts package stays narrow and cannot be bypassed by CI/workspace drift.
TDD steps:
1. Write test: add repo tooling guards for the contracts package presence and workflow coverage.
2. Run test: confirm it fails before the validation doc/workflow updates.
3. Implement: document the contracts package validation story and keep the repo tooling workflow watching the right paths.
4. Run test: confirm root guard tests pass.
5. Commit: `test: guard contracts nucleus validation coverage`
Expected output: CI and docs stay aligned with the contracts package boundary.

## Task 7: Final PR4 Validation Pass
File(s): `package.json`, `apps/meeting-web/package.json`, `apps/roadmap-web/package.json`, `apps/meeting-api/tests/backend/**`
OWNS: `package.json`, `apps/meeting-web/package.json`, `apps/roadmap-web/package.json`, `apps/meeting-api/tests/backend/**`
What to implement: run the scoped validation stack for all three deployables after adoption and capture any remaining known constraints without broadening PR4 scope.
TDD steps:
1. Write test: no new test file; use the validation entrypoints as the acceptance test.
2. Run test: execute root repo tooling tests, roadmap tests, meeting-web tests, and meeting-api validation to expose any drift.
3. Implement: fix only PR4-caused breakage.
4. Run test: confirm all scoped validations pass again.
5. Commit: `chore: finalize contracts nucleus validation`
Expected output: PR4 exits with a green scoped baseline across root, roadmap, meeting-web, and meeting-api validation paths.
