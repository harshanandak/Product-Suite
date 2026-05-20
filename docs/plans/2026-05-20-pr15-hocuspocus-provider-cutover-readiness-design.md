# PR15 Hocuspocus Provider Cutover Readiness Design

Feature: `pr15-hocuspocus-provider-cutover-readiness`
Date: 2026-05-20
Status: active
Classification: Critical - realtime provider, auth token, and service cutover readiness
Beads: `product-suite-yo0`
Research: `docs/research/pr15-hocuspocus-provider-cutover-readiness.md`

## Purpose

Prove Roadmap can activate the Hocuspocus realtime provider path with real provider inputs before any default traffic is moved off the existing Supabase Realtime fallback.

## Success Criteria

- Shared canvas realtime contracts support document-aware providers without importing Roadmap, Next.js, Supabase, or Hocuspocus provider packages into `packages/ui-canvas`.
- `HybridProvider` passes the active Yjs document to realtime adapters while preserving current Supabase Realtime behavior.
- Roadmap has a tested Hocuspocus connection factory boundary that receives URL, document name, token, handlers, and Yjs document.
- Token creation is explicit and fails closed when unavailable; missing token/provider inputs keep Supabase fallback active.
- PR14 runtime safety remains intact: `services/hocuspocus` cannot report ready without required auth verifier dependencies.
- Durable plan, repo-tooling tests, and validation docs identify PR14 as merged and PR15 as active.

## Out Of Scope

- Removing Supabase Realtime fallback as the default.
- Changing team membership or auth provider semantics.
- Adding production secrets, production deployment promotion, or cross-region fanout.
- Replacing storage persistence; Supabase Storage and metadata update behavior remain unchanged.
- Building presence UI or awareness display.

## Approach Selected

Add a document-aware realtime seam first, then wire Roadmap's Hocuspocus provider inputs behind the existing explicit selection gate. The Hocuspocus path should only activate when URL, token factory, and connection factory are complete. Supabase remains the default and fallback.

This is safer than a full cutover because Hocuspocus provider behavior depends on binding directly to the live Yjs document. The current broadcast-shaped `CanvasRealtimeConnection` was enough for Supabase Realtime but not enough to prove true Hocuspocus provider readiness.

## Constraints

- `packages/ui-canvas` remains a pure boundary package with no app/runtime imports.
- Roadmap browser code must use direct `process.env.NEXT_PUBLIC_*` access where build-time inlining is required.
- Token values must not be logged, serialized in readiness, or stored in docs/tests.
- Any partial Hocuspocus configuration must leave existing Supabase collaboration behavior unchanged.
- Provider failures must surface through the existing sync error path without corrupting loaded Yjs state.

## Edge Cases

- Missing Hocuspocus URL: Supabase fallback remains active.
- Missing token factory: Supabase fallback remains active.
- Token factory returns empty or whitespace: fail before provider construction.
- Provider construction throws: surface sync error and avoid marking connected.
- Auth failure callback fires: surface sync error and mark disconnected.
- No Yjs document is available: provider path cannot activate.

## Ambiguity Policy

Use the 7-dimension decision gate. Proceed when the choice preserves existing canvas behavior, keeps package boundaries pure, and confidence is at least 80%. Stop and ask before removing Supabase fallback, changing auth provider semantics, or introducing production deployment requirements.
