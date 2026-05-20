# PR16 Hocuspocus Provider Controlled Rollout Design

Feature: `pr16-hocuspocus-provider-controlled-rollout`
Date: 2026-05-20
Status: planned
Beads: `product-suite-bc8`

## Purpose

Move Roadmap from provider readiness to a controlled Hocuspocus rollout path while preserving the Supabase Realtime fallback as an operator rollback.

## Success Criteria

- Roadmap only selects Hocuspocus when a rollout flag and all required provider inputs are present.
- Partial Hocuspocus configuration keeps Supabase Realtime as the active path.
- Provider lifecycle events are observable through existing connection and sync error callbacks.
- Service/client token context tests prove document identity and read/write scope stay aligned.
- Durable plan and repo-tooling tests mark PR15 verified and PR16 active.

## Out Of Scope

- Removing Supabase Realtime fallback.
- Changing canonical auth provider semantics.
- Persisting canvas state through the Hocuspocus service.
- Adding presence UI or collaborative cursor UI.
- Promoting production deployment settings.

## Approach Selected

Use an explicit opt-in rollout gate around the provider path added in PR15. The gate should require a public service URL, a private app-owned token factory, an injected provider factory, and a rollout flag before selecting Hocuspocus.

This keeps the first live-traffic-capable change reversible. Operators can disable one flag and return to Supabase Realtime without reverting code.

## Constraints

- Tokens must not be read from public environment variables or logged.
- `packages/ui-canvas` must stay free of Hocuspocus, Supabase, Next.js, and Roadmap imports.
- The Hocuspocus runtime must continue to fail before listening when `verifyAuthToken` is missing.
- Roadmap fallback behavior must be explicit in tests.

## Edge Cases

- Missing rollout flag: Supabase fallback remains active.
- Missing URL: Supabase fallback remains active.
- Missing token factory: Supabase fallback remains active.
- Empty token from factory: throw before provider construction.
- Provider authentication failure: mark disconnected and report a sync error without mutating loaded Yjs state.
- Read-only token context: service marks the connection read-only and denies document changes.

## Technical Research

Hocuspocus docs confirm that `HocuspocusProvider` is configured with `url`, `name`, `document`, `token`, and lifecycle handlers including `onStatus`, `onAuthenticated`, `onAuthenticationFailed`, and `onSynced`. Server `onAuthenticate` validates the token for the requested document and can reject the connection. The current service fail-closed startup behavior remains correct because a collaboration service without auth verification should not listen.

## Ambiguity Policy

Use the 7-dimension `/dev` decision gate for gaps. Proceed when confidence is at least 80 percent and the decision preserves fallback behavior; stop and ask when a gap could change live collaboration traffic or auth semantics.
