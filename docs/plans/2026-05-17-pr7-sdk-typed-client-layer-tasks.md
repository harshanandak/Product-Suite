# PR7 SDK / Typed Client Layer Tasks

## Task 1: Workspace And Tooling Awareness
OWNS: `package.json`, `.github/workflows/meeting-web-ci.yml`, `.github/workflows/roadmap-web-ci.yml`, `.github/workflows/roadmap-web-playwright.yml`, `.github/workflows/meeting-api-ci.yml`, `.github/workflows/meeting-api-railway-preview.yml`, `test/repo-tooling.test.js`, `docs/plans/building-blocks-transformation-pr-plan.md`

File(s): root package metadata, CI workflows, repo tooling tests, building-blocks plan.

What to implement: Add `packages/sdk` to root workspace and CI path filters. Update repo tooling tests to mark PR6 merged and PR7 active, and assert SDK workspace/CI awareness.

TDD steps:
1. Write/adjust test: `test/repo-tooling.test.js` should fail until `packages/sdk` is listed in workspaces and CI filters.
2. Run test: `bun run test:repo-tooling`; expect missing workspace/path assertions to fail.
3. Implement: update workspace metadata, workflows, and plan current status.
4. Run test: `bun run test:repo-tooling`; expect pass.
5. Commit: `test: add sdk workspace tooling guard`

Expected output: Repo tooling tests prove SDK package changes trigger relevant CI and current status reflects PR7 active.

## Task 2: SDK Package Skeleton And Transport Contract
OWNS: `packages/sdk/package.json`, `packages/sdk/src/index.js`, `packages/sdk/src/index.d.ts`, `packages/sdk/src/meeting.js`, `packages/sdk/src/meeting.test.ts`

File(s): new `packages/sdk` package.

What to implement: Create `@product-suite/sdk` with a Meeting API client factory that accepts an injected HTTP transport and validates required methods.

TDD steps:
1. Write test: `packages/sdk/src/meeting.test.ts` asserts the client rejects missing transport methods and exports expected meeting client methods.
2. Run test: `bun run --cwd packages/sdk test`; expect module/package missing failure.
3. Implement: package metadata, exports, type declarations, client factory.
4. Run test: `bun run --cwd packages/sdk test`; expect pass.
5. Commit: `feat: add sdk meeting client package`

Expected output: SDK package can be imported and validates its transport dependency.

## Task 3: Meeting Endpoint Shape Coverage
OWNS: `packages/sdk/src/meeting.js`, `packages/sdk/src/index.d.ts`, `packages/sdk/src/meeting.test.ts`

File(s): SDK meeting client implementation and tests.

What to implement: Add typed Meeting API methods for existing `meeting-web` HTTP endpoints: auth session exchange, current user/onboarding/org invite, meetings CRUD, transcribe, transcript, summary, chat, search/export, engines, health, voice chat, languages, text translation, and meeting transcript translation.

TDD steps:
1. Write tests: assert each method calls the expected HTTP verb/path/body/options.
2. Run test: `bun run --cwd packages/sdk test`; expect missing method/path failures.
3. Implement: endpoint wrappers with encoded path segments and preserved multipart options/timeouts.
4. Run test: `bun run --cwd packages/sdk test`; expect pass.
5. Commit: `feat: cover meeting api endpoint shapes in sdk`

Expected output: SDK owns the canonical Meeting API HTTP shapes.

## Task 4: Meeting-Web Compatibility Facade Delegation
OWNS: `apps/meeting-web/src/lib/api.js`, `apps/meeting-web/src/lib/__tests__/api.test.js`, `apps/meeting-web/package.json`

File(s): meeting-web local API facade and tests.

What to implement: Add `@product-suite/sdk` dependency to meeting-web and delegate Meeting API endpoint functions from `api.js` to an SDK client built from the existing axios instance. Keep runtime config, auth token storage, hosted auth client, and all named exports stable.

TDD steps:
1. Write tests: update `apps/meeting-web/src/lib/__tests__/api.test.js` to prove selected endpoint exports delegate through the SDK while auth/runtime exports still behave.
2. Run test: `bun run --cwd apps/meeting-web test src/lib/__tests__/api.test.js`; expect SDK delegation assertions to fail.
3. Implement: import SDK factory, create client using existing axios instance, replace endpoint wrappers with delegating exports.
4. Run test: targeted api test; expect pass.
5. Commit: `refactor: delegate meeting web api facade to sdk`

Expected output: Existing meeting-web consumers keep importing `api.js`, while endpoint shapes come from SDK.

## Task 5: Validation And PR7 Plan Context
OWNS: `docs/plans/2026-05-17-pr7-sdk-typed-client-layer-decisions.md`, `docs/plans/2026-05-17-pr7-sdk-typed-client-layer-design.md`, `docs/plans/2026-05-17-pr7-sdk-typed-client-layer-tasks.md`

File(s): PR7 planning docs and validation evidence.

What to implement: Record implementation decisions and final validation evidence for handoff.

TDD steps:
1. Write/update docs: decisions doc starts with the selected SDK boundary and any decision gates.
2. Run validation: `bun run check:source-test`, `bun run test:repo-tooling`, `bun run --cwd packages/sdk test`, targeted meeting-web api tests, and affected CI commands.
3. Implement fixes for any validation failures.
4. Rerun failed checks until green.
5. Commit: `docs: record pr7 sdk validation context`

Expected output: PR7 has durable plan, task, decision, and validation context for `/ship`.
