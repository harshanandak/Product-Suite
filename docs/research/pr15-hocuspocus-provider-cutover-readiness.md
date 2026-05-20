# PR15 Hocuspocus Provider Cutover Readiness Research

Date: 2026-05-20
Beads: `product-suite-yo0`

## Trigger

PR14 made `services/hocuspocus` runnable and made Roadmap realtime selection explicit, but it intentionally did not move live canvas traffic to Hocuspocus. The next gap is readiness for that cutover: Roadmap still lacks a real browser Hocuspocus provider connection, a token factory, and a runtime dependency path that can be validated before fallback removal.

## Current State

- `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts` selects Hocuspocus only when the service URL, token factory, and connection factory are all present.
- `HybridProvider` owns the Yjs document, local update broadcasting, storage load/save, and connection lifecycle.
- `@hocuspocus/provider` is not currently declared in `apps/roadmap-web/package.json` or the root lockfile.
- `services/hocuspocus` now fails fast when `verifyAuthToken` is not injected, so cutover readiness must include a real verifier/bootstrap path or an explicit non-production stub that cannot report production-ready.

## External Notes

Hocuspocus browser clients use `HocuspocusProvider` with a WebSocket URL, document name, Yjs document, token, and event handlers such as status/authentication callbacks. The provider synchronizes the Yjs document directly and exposes lifecycle cleanup through `destroy()`.

Implication: the existing Roadmap `CanvasRealtimeAdapter.connect(identity, handlers)` shape is not enough for a true Hocuspocus provider because it does not receive the Yjs `Doc`. PR15 should add a document-aware adapter seam before attempting any fallback removal.

## Architecture Implication

The safe next slice is not a full production cutover. It is a cutover-readiness PR:

- extend the canvas realtime boundary so document-native providers can bind to the Yjs document;
- add a Roadmap Hocuspocus connection factory that can be tested without opening real sockets;
- add a token factory boundary that fails closed when a token is unavailable;
- keep Supabase Realtime fallback explicit until the provider path is validated end-to-end.

## Security And Reliability Notes

- Auth tokens must never be logged or included in readiness payloads.
- A configured Hocuspocus URL without a token factory or provider factory must continue to fall back rather than half-enable.
- Provider auth failure should surface through existing non-fatal sync error handling and should not corrupt local Yjs state.
- The service runtime must not report deployable readiness unless its auth verifier dependency is present.

## TDD Hypotheses

1. Roadmap tests should fail until `HybridProvider` passes its Yjs document into the realtime adapter.
2. Canvas package tests should fail until the shared realtime interface accepts document-aware provider inputs without forcing app dependencies into `packages/ui-canvas`.
3. Roadmap tests should fail until the Hocuspocus provider factory receives URL, document name, token, handlers, and Yjs document.
4. Service tests should fail if runtime dependency validation can be bypassed.
5. Repo-tooling tests should fail until the durable plan marks PR14 verified and PR15 active.
