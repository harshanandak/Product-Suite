# PR7 SDK / Typed Client Layer Design

## Feature
- Slug: `pr7-sdk-typed-client-layer`
- Date: 2026-05-17
- Status: plan
- Beads: `product-suite-0rs`

## Purpose
PR7 creates a shared SDK package so application shells stop inventing HTTP request shapes locally. The first consumer is `meeting-web`, whose current `apps/meeting-web/src/lib/api.js` file owns runtime config, auth token handling, hosted auth helpers, and all Meeting API endpoint wrappers in one untyped module.

## Success Criteria
- `packages/sdk` exists as a workspace package with exported Meeting API client helpers and TypeScript declarations.
- `meeting-web` consumes the SDK for Meeting API request methods while preserving the current public exports from `apps/meeting-web/src/lib/api.js`.
- Runtime config, bearer token injection, multipart uploads, request timeouts, and hosted auth/session exchange behavior keep current behavior.
- CI and local validation cover SDK endpoint shape tests, the compatibility facade, and repo tooling workspace detection.

## Out Of Scope
- No backend endpoint redesign.
- No generated OpenAPI pipeline.
- No broad conversion of `meeting-web` from JS to TS.
- No Roadmap API client migration beyond workspace/tooling awareness.
- No UI behavior changes.

## Approach Selected
Create `@product-suite/sdk` as a small hand-written workspace package that accepts injected transport/runtime dependencies. Keep `meeting-web` runtime config and hosted auth concerns in `apps/meeting-web/src/lib/api.js`, but delegate Meeting API HTTP calls to the SDK.

This is selected over a full OpenAPI generator because there is no verified OpenAPI contract in the repo today and PR7 needs a low-risk typed layer. It is selected over moving all auth/runtime code into the SDK because hosted auth is still shell-specific and depends on React adapter/browser runtime behavior.

## Constraints
- Preserve the existing `api.js` named exports so current pages/hooks continue to work.
- Keep axios available to `meeting-web`; the SDK should not hide global runtime config or own browser storage.
- Add workspace and CI path coverage for `packages/sdk`.
- Keep contracts stable by reusing `@product-suite/contracts` where contract keys already exist.
- Use TDD for source changes and keep tests colocated with source/package changes.

## Edge Cases
- Multipart endpoints must preserve `Content-Type: multipart/form-data` and endpoint-specific timeouts.
- Auth token absence must omit `Authorization`, not send an empty bearer token.
- SDK client methods must not duplicate `/api` base URL normalization; the shell remains responsible for base URL resolution.
- Hosted auth token exchange must keep provider selection from runtime config.
- Existing consumers importing from `@/lib/api` or `../lib/api` must not need immediate import changes.

## Technical Research
- Current endpoint wrappers are concentrated in `apps/meeting-web/src/lib/api.js`, including auth, meetings, transcription, summary, chat, search/export, engines, health, voice chat, languages, and translation methods.
- Existing consumers import from the local facade in `apps/meeting-web/src/hooks/useBuddyAgent.js`, `apps/meeting-web/src/hooks/useMeetingState.js`, `apps/meeting-web/src/hooks/useRealtimeTranscript.js`, `apps/meeting-web/src/pages/authPageUtils.js`, `apps/meeting-web/src/pages/CallbackPage.jsx`, `apps/meeting-web/src/pages/DashboardHomePage.jsx`, `apps/meeting-web/src/pages/LandingPage.jsx`, `apps/meeting-web/src/pages/SignInPage.jsx`, `apps/meeting-web/src/App.jsx`, and meeting-web tests.
- Root workspaces currently include `apps/meeting-web`, `apps/roadmap-web`, and `packages/contracts`; PR7 must add `packages/sdk`.
- Existing repo tooling tests explicitly assert package/workspace and CI path awareness; PR7 should update those tests before changing package metadata.

## OWASP Review
- A01 Broken Access Control: bearer token injection must remain explicit and must not silently drop auth headers when a token is present.
- A02 Cryptographic Failures: no new crypto is introduced; do not move hosted identity token parsing into unreviewed generic logic.
- A03 Injection: SDK path builders must encode dynamic path segments such as meeting IDs.
- A05 Security Misconfiguration: runtime base URL resolution remains in the shell to avoid hidden production defaults.
- A08 Software And Data Integrity Failures: workspace/package exports must be covered by tests so consumers cannot import stale paths.

## TDD Scenarios
- Happy path: SDK Meeting client maps each existing method to the same method/path/body/options currently used by `api.js`.
- Error path: creating a client without required transport methods throws a clear initialization error.
- Edge path: multipart and translation methods preserve form data/options without mutating input.
- Integration path: `meeting-web` facade delegates Meeting API methods to the SDK while retaining existing auth/runtime exports.
- Tooling path: root workspace, CI path filters, and repo tooling tests recognize `packages/sdk`.

## Ambiguity Policy
Use the existing 7-dimension decision gate. If implementation confidence is at least 80%, proceed with the conservative local pattern and document the decision in `docs/plans/2026-05-17-pr7-sdk-typed-client-layer-decisions.md`. Below 80%, stop and ask before expanding scope.
