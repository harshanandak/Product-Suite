# HTTPS token adapters tasks

## Task 1: Enforce secure API bases across token-bearing adapters

OWNS: `apps/platform-web/src/env.ts`, `apps/platform-web/src/data/work-items/network-repository.ts`, `apps/platform-web/src/data/meeting-actions/network-repository.ts`, `apps/platform-web/src/data/agent/threads.ts`, `apps/platform-web/src/data/agent/transport.ts`, `apps/platform-web/src/data/memories/adapter.ts`, `apps/platform-web/src/data/memory-impact/adapter.ts`, `apps/platform-web/src/data/proposals/network-repository.ts`, `apps/platform-web/src/data/api-base-url-security.test.ts`

What to implement: Add one shared synchronous API-base guard and invoke it immediately after all seven factories resolve their base. Replace the proposal repository's inline check. Preserve exact-empty same-origin mode and all valid/missing-token behavior.

TDD steps:

1. Write `apps/platform-web/src/data/api-base-url-security.test.ts` with table assertions covering all seven factories and every locked valid/invalid URL class. Assert invalid inputs throw synchronously before `getToken` or `fetch`, and cover valid plus missing-token legacy behavior.
2. Run `bun run --cwd apps/platform-web test src/data/api-base-url-security.test.ts`; confirm failure because the shared guard/export and six adapter checks do not exist.
3. Implement `assertSecureApiBaseUrl` in `apps/platform-web/src/env.ts` and call it from each owned factory immediately after resolving the base.
4. Rerun the focused test and confirm it passes, then run platform-web lint, typecheck, focused adapter tests, and the package test suite in proportion.
5. Commit: `fix(platform-web): require secure token transport origins`

Expected output: every invalid configured base fails synchronously with zero token/network calls; HTTPS and documented empty same-origin requests retain their existing URL and authorization behavior.
