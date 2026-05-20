# PR14 Realtime Service Runtime Wiring Research

Date: 2026-05-20
Beads: `product-suite-36p`

## Local Findings

- PR13 added `services/hocuspocus` as an internal workspace package and wired root validation, repo-tooling CI, Roadmap CI, and Roadmap Playwright CI to watch it.
- `services/hocuspocus/src/index.ts` owns canonical canvas document naming, token context validation, runtime config parsing, and Hocuspocus hook option creation.
- `services/hocuspocus/src/server.ts` can construct an injected `@hocuspocus/server` server, but there is no runtime entrypoint that starts the service.
- `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts` still creates a Supabase Realtime broadcast connection while using `createHocuspocusDocumentName` for the canonical room name.
- Existing Meeting API Railway preview workflow gives the repo a deployment pattern, but it is specific to the Python backend and does not yet cover `services/hocuspocus`.

## Runtime Gap

PR13 deliberately stopped at the service boundary. The next gap is runtime ownership: there is no `start` script, service entrypoint, environment example, health check, or CI/deployment path proving that the Hocuspocus boundary can run as a deployable service.

PR14 should wire a deployable runtime path while keeping the current Roadmap Supabase Realtime fallback explicit. Removing the fallback is a later cutover decision because it changes live collaboration behavior.

## Hocuspocus Documentation Notes

Context7 resolved the official Hocuspocus docs as `/ueberdosis/hocuspocus`.

Relevant current API patterns:

- `@hocuspocus/server` creates a `Server` and starts it with `server.listen()`.
- Server lifecycle hooks support `onAuthenticate`, `onLoadDocument`, `onChange`, `onStoreDocument`, connection lifecycle hooks, and awareness hooks.
- Hocuspocus v4 hook payloads use web-standard `Request` and `Headers`.
- `onStoreDocument` uses `lastContext` because store hooks can run from non-connection sources.
- Browser clients can connect with `@hocuspocus/provider` using a WebSocket URL, document name, Yjs document, and token.

## Boundary Direction

The safest next slice is to make `services/hocuspocus` runnable and observable without forcing Roadmap to use it by default. Add runtime wiring, environment documentation, service validation, and deployment workflow scaffolding. Then add Roadmap configuration helpers that can choose Hocuspocus when fully configured and otherwise keep the existing Supabase Realtime adapter path explicit.

This keeps PR14 focused on runtime readiness rather than product cutover.

## DRY Check

Existing implementations to extend:

- `services/hocuspocus/src/index.ts`: runtime config, auth context, and hook wiring.
- `services/hocuspocus/src/server.ts`: injectable server construction.
- `services/hocuspocus/src/*.test.ts`: focused service behavior tests.
- `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`: current app-owned Supabase fallback adapter.
- `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`: adapter-level assertions.
- `test/repo-tooling.test.js`: durable plan and CI/docs coverage.

PR14 should not duplicate canvas contracts or create a second realtime abstraction. It should extend the existing service package and Roadmap adapter boundary.

## OWASP Notes

- A01 Broken Access Control: a runnable collaboration service can bypass app route checks if token verification is weak. Mitigation: keep token verification injectable and fail closed when missing.
- A03 Injection: document names and environment values are input-derived. Mitigation: reuse identity validation and strict runtime config parsing.
- A04 Insecure Design: two realtime paths can create ambiguous ownership. Mitigation: keep Hocuspocus opt-in and fallback explicit until a later cutover PR.
- A05 Security Misconfiguration: WebSocket URLs, allowed origins, ports, and secrets can be incomplete. Mitigation: add env examples, config validation, and startup tests.
- A08 Software and Data Integrity Failures: Yjs state load/store must not corrupt persisted canvas state. Mitigation: keep persistence adapters injected and test load/store delegation.
- A09 Logging and Monitoring Failures: service runtime failures must be visible. Mitigation: add a health endpoint or startup/ready signal and validation coverage.

## TDD Scenarios

1. `services/hocuspocus` exposes a runtime entrypoint that starts an injected server with validated config.
2. Runtime config rejects missing or invalid required environment values before listening.
3. A health or readiness surface reports the service name and runtime status without exposing secrets.
4. Roadmap adapter config uses Hocuspocus only when URL and token factory are present; otherwise it keeps the Supabase fallback explicit.
5. Repo tooling and CI tests fail until PR14 artifacts, service runtime scripts, docs, and workflow path filters are updated.
