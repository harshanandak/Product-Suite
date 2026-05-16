# PR5 Auth Contracts And Adapters Design

Feature: pr5-auth-contracts-and-adapters
Date: 2026-05-16
Status: planned
Issue: product-suite-ef5
Classification: Critical

## Purpose

Unify the auth vocabulary across Product Suite before changing providers. PR5 defines a shared claims model and adapter contracts that current roadmap-web, meeting-web, and meeting-api auth flows can map into without changing login providers.

## Success Criteria

- `@product-suite/contracts` exports auth contracts for `AuthClaims`, `TokenVerifier`, `SessionBridge`, and `WorkspaceAccessResolver`.
- Existing contracts tests cover the auth contract artifact and required fields.
- Adapter helpers prove current Supabase, hosted-auth, and backend actor shapes can map into the shared contract without provider rollout.
- Existing auth-related tests continue to pass for contracts, meeting-web, roadmap-web, and meeting-api.

## Out Of Scope

- No switch away from Supabase Auth in roadmap-web.
- No canonical IdP rollout.
- No JWKS/OIDC verification rewrite in meeting-api.
- No database migration or auth schema migration.
- No user-visible login, signup, invite, or workspace-routing behavior changes.

## Approach Selected

Use a compatibility-first contract package expansion:

1. Add auth contract artifact and JS/TS exports in `packages/contracts`.
2. Add narrow adapter helpers near existing app auth boundaries.
3. Prove mapping behavior with tests before touching production callers.

This keeps PR5 reversible and gives PR6 a typed contract to target.

## Constraints

- Existing provider-specific code remains authoritative for runtime behavior.
- Token values must never be logged, serialized into test snapshots, or exposed in contract metadata.
- Shared claims must preserve provider, subject, email, display name, tenant/workspace context, roles, issued/expiry fields, and raw provider claim escape hatch.
- Adapters must fail closed when required identity or tenant/workspace context is missing.

## Edge Cases

- Hosted auth session exists but token retrieval fails: session bridge reports unauthenticated or error state without inventing a token.
- Roadmap Supabase user exists without workspace membership: workspace resolver denies access.
- Meeting API credentials have valid signature but missing hosted tenant context: adapter surfaces invalid claims.
- Provider-specific fields differ: map known fields into shared claims and keep unknowns in provider claims.

## Technical Research

Research is captured in `docs/research/pr5-auth-contracts-and-adapters.md`.

Security anchors:

- OWASP Authentication Cheat Sheet: preserve current auth behavior while adding compatibility tests.
- OWASP Session Management Cheat Sheet: keep tokens/session IDs sensitive through adapters.
- OpenID Connect Core and RFC 7519: use standard issuer, subject, audience, issued-at, expiry, and JWT ID vocabulary where applicable.

## Ambiguity Policy

Use the 7-dimension `/dev` decision gate for gaps. Proceed only for local, reversible mapping details. Stop for any provider switch, auth behavior change, data exposure change, schema migration, or endpoint contract change.
