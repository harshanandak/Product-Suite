# PR16 Hocuspocus Provider Controlled Rollout Research

## Current State

PR15 made the Roadmap Hocuspocus provider path constructible behind explicit inputs: a service URL, a synchronous non-empty token factory, a provider connection factory, and the active Yjs document. The default Roadmap behavior still falls back to Supabase Realtime unless those inputs are complete.

The next gap is a controlled rollout boundary. Roadmap can build a provider connection in tests, but the app shell does not yet have a production-safe activation policy, rollout telemetry, or rollback guard that proves Hocuspocus can carry real canvas traffic without silently changing collaboration behavior.

## Codebase Notes

- `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts` owns Roadmap realtime selection, Hocuspocus provider construction, auth token factory handling, and Supabase fallback.
- `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts` owns the active Yjs document, persistence saves, update broadcasting, connection lifecycle, and sync error callback.
- `services/hocuspocus/src/index.ts` owns document naming, token context validation, auth/read/write hooks, and fail-closed service options.
- `services/hocuspocus/src/runtime.ts` refuses to start without `verifyAuthToken`, which is the right default for runtime safety because a listening collaboration service without an auth verifier would accept unauthenticated document connection attempts.

## Hocuspocus Documentation Notes

The official Hocuspocus docs are available at `/ueberdosis/hocuspocus`.

Relevant current docs show:
- `HocuspocusProvider` accepts `url`, `name`, `document`, `token`, and lifecycle handlers.
- Provider lifecycle handlers include `onStatus`, `onAuthenticated`, `onAuthenticationFailed`, `onSynced`, and `onDisconnect`.
- Server-side `onAuthenticate` receives token and document context and can reject the connection.
- Hocuspocus v4 hook payloads use web-standard `Request` and `Headers` for request data.

## Recommended Slice

PR16 should be a controlled rollout PR, not a permanent fallback removal PR.

Scope:
- add an explicit Roadmap rollout gate that requires URL, token factory, provider factory, and an enable flag before Hocuspocus is selected;
- add provider lifecycle instrumentation through the existing sync error and connection-state path;
- add a smokeable service-client contract test that proves token context, document name, and read/write scope stay aligned;
- document the rollback path that disables the rollout flag and restores Supabase fallback.

Out of scope:
- removing Supabase Realtime fallback;
- changing canonical auth provider semantics;
- moving persistence from Supabase Storage into Hocuspocus-owned storage;
- adding user-facing presence UI.

## Risks

- A configured URL without a complete token/provider path could half-enable collaboration. Mitigation: require a dedicated rollout flag and keep current fallback behavior for partial config.
- Provider auth failures could look like transient disconnects. Mitigation: map authentication failure separately into existing sync error callbacks and tests.
- Read-only Hocuspocus contexts could accidentally permit writes. Mitigation: keep server `connectionConfig.readOnly` and on-change guards covered in service tests.
- Fallback removal would be hard to rollback. Mitigation: PR16 keeps fallback available and documents the operator rollback.

## TDD Scenarios

1. Roadmap realtime selection remains Supabase unless the Hocuspocus rollout flag and all provider inputs are complete.
2. A complete rollout config selects Hocuspocus and forwards URL, document name, token, handlers, and Yjs document unchanged.
3. Provider lifecycle callbacks distinguish connected, disconnected, authenticated, authentication failed, and synced states without leaking token values.
4. Service tests prove verified token context document identity must match the requested Hocuspocus document name.
5. Repo-tooling tests prove the durable plan marks PR15 verified and PR16 active.
