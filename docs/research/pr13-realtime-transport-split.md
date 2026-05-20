# PR13 Realtime Transport Split Research

Date: 2026-05-19
Beads: `product-suite-6w3`

## Local Findings

- `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts` owns local Yjs update handling, realtime fanout, load/save orchestration, dirty tracking, and browser lifecycle saves.
- `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts` adapts the generic `@product-suite/ui-canvas` boundary to Supabase Storage, Supabase metadata updates, and Supabase Realtime broadcast channels.
- `apps/roadmap-web/src/components/blocksuite/use-blocksuite-sync.ts` constructs the Supabase canvas boundary directly, then injects persistence, metadata, and realtime adapters into `HybridProvider`.
- `packages/ui-canvas/src/index.ts` already defines reusable canvas identity, persistence, metadata, and realtime adapter contracts. PR13 should extend these contracts instead of adding a parallel Roadmap-only transport shape.
- `services/README.md` already names `hocuspocus` as a future standalone service candidate.

## Current Transport Ownership

The app shell still owns canonical realtime transport in the Supabase Realtime channel construction and the Yjs update encode/decode loop. Persistence is already partly isolated through `CanvasPersistenceAdapter`, but transport ownership is not service-owned yet.

## Hocuspocus Documentation Notes

Context7 resolved the official Hocuspocus docs as `/ueberdosis/hocuspocus`.

Relevant current API patterns:

- `@hocuspocus/server` exposes `Server` / `Server.configure` for a Node WebSocket collaboration service.
- Server configuration supports typed hook context through TypeScript generics.
- `onAuthenticate` can validate a token and return context data used by later hooks.
- `onLoadDocument`, `onChange`, and debounced `onStoreDocument` are the service-side persistence hooks.
- Connection lifecycle hooks include `onConnect`, `connected`, `onDisconnect`, and awareness hooks.
- Hocuspocus provider packages can attach browser clients to a document room and token.

## Boundary Direction

The safest PR13 slice is to introduce `services/hocuspocus` as an internal workspace package that owns canonical canvas document room naming, token/context contract types, service runtime configuration, and a typed Hocuspocus server factory with injectable auth and persistence hooks.

Roadmap should remain responsible for shell auth/session lookup and browser adapter creation, but those adapters should consume service-owned contracts rather than hardcoding transport semantics directly in the app shell.

## DRY Check

Existing implementations to extend:

- `packages/ui-canvas/src/index.ts`: canvas transport and persistence contracts.
- `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`: current Supabase Realtime adapter.
- `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts`: current Yjs update application and dirty-state behavior.
- `apps/roadmap-web/src/components/blocksuite/__tests__/hybrid-provider.test.ts`: existing boundary tests for app-shell decoupling.
- `test/repo-tooling.test.js`: root tooling coverage for service registration.

PR13 should not create a second generic canvas contract package. It should extend `@product-suite/ui-canvas` and put Hocuspocus-specific service ownership in `services/hocuspocus`.

## OWASP Notes

- A01 Broken Access Control: realtime document access can bypass route checks if service auth is weak. Mitigation: define typed auth context and require an injectable token verifier.
- A03 Injection: document names and room identifiers are input-derived. Mitigation: reuse safe canvas identity validation and add document-name tests.
- A04 Insecure Design: two active transports without a canonical owner would be ambiguous. Mitigation: keep one service-owned contract and one Roadmap adapter path.
- A05 Security Misconfiguration: WebSocket URLs and service secrets can be misconfigured. Mitigation: define explicit runtime config and fail closed for missing required values.
- A08 Software and Data Integrity Failures: Yjs persistence must not corrupt state. Mitigation: keep persistence hooks injectable and test load/store behavior.
- A09 Logging and Monitoring Failures: collaboration disconnects should not be silent. Mitigation: expose lifecycle hooks/status callbacks through the service boundary.

## TDD Scenarios

1. `services/hocuspocus` rejects unsafe canvas document names before creating a room.
2. `services/hocuspocus` server factory wires authentication, load, change, and store hooks through injected dependencies.
3. Roadmap Hocuspocus boundary config fails closed when the collaboration service URL or token factory is missing.
4. Existing Supabase canvas persistence behavior stays covered while realtime ownership moves behind service-owned contracts.
5. Repo tooling fails until root workspaces, validation scripts, docs, and CI filters include `services/hocuspocus`.
