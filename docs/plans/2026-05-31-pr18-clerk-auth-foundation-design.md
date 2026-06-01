# PR18 Clerk Auth Foundation Design

Feature: `pr18-clerk-auth-foundation`
Beads: `product-suite-1yh`
Date: 2026-05-31
Status: ready-for-dev

## Purpose

Introduce Clerk as the canonical user-facing auth foundation for Product Suite while preserving current database ownership and module boundaries.

PR18 should make the auth direction executable: apps and services need a shared Clerk identity contract, fail-closed env requirements, a single redirect/callback boundary, and backend JWT verification expectations before PR19 creates platform identity tables.

## Success Criteria

- Product Suite has documented Clerk env contracts for local, preview, and production.
- Shared auth contracts represent Clerk identity and token verification failure modes without leaking raw tokens.
- The platform shell boundary defines `ClerkProvider`, middleware route protection, public auth routes, and callback ownership.
- Backend services have a shared Clerk JWT/JWKS validation contract covering issuer, audience, subject, and authorized party checks.
- User/org sync is designed for future `platform.users`, `platform.workspaces`, and memberships, but PR18 does not add schema migrations.
- Redirect tests cover allowed return paths, external URL rejection, and redirect-loop prevention.

## Out Of Scope

- No PR19 platform schema migrations.
- No Meeting database cutover.
- No broad module route consolidation.
- No browser Supabase access that depends on Clerk JWT/RLS mapping.
- No payment, billing, or analytics sink implementation.

## Approach Selected

Use a contract-first Clerk foundation.

The first implementation should extend repo contracts and tests before runtime cutover. This keeps auth behavior reviewable while avoiding a partial production switch to Clerk across every app and service.

Implementation should use current Clerk primitives:

- `ClerkProvider` in the App Router root layout boundary.
- `clerkMiddleware` with explicit public and protected route matchers.
- Clerk session JWT verification for services, with token input from `Authorization: Bearer` or `__session`.
- issuer, audience, subject, and authorized-party validation before identity reaches service code.

## Constraints

- Clerk owns login, sessions, users, organizations, invitations, and user-management UI.
- Supabase Auth is not the primary user auth provider.
- Backend services must consume normalized auth claims, not raw Clerk tokens.
- Sensitive writes must still use server-side membership checks; JWT membership hints are not enough.
- Env validation must fail closed for protected runtimes.
- Return intent must be signed or otherwise integrity-protected before callback redirects use it.

## Edge Cases

- Clerk webhook replay or duplicate delivery.
- User signs in before webhook sync completes.
- Clerk organization deletion while internal workspace rows still exist.
- Stale membership claims in a still-valid session JWT.
- Preview deployment points at the wrong Clerk instance.
- Callback receives an external URL, invalid signature, missing module hint, or a path that redirects back to auth.
- Backend service receives a token with mismatched issuer, audience, subject, authorized party, or organization claim.

## Mitigations

- Idempotent webhook design keyed by Clerk event ID and external user/org IDs.
- Lazy first-request reconciliation when webhook sync has not completed.
- Soft-disable workspaces before hard deletion.
- Server-side membership checks for sensitive writes.
- Explicit env contract tests for publishable key, secret key, issuer, audience, and allowed origins.
- Allowed-prefix redirect whitelist plus callback-loop tests.
- Shared token verifier contract that returns normalized claims or a typed auth error.

## Technical Research

Research source: `docs/research/pr18-clerk-auth-foundation.md`.

Clerk's current Next.js App Router docs place `ClerkProvider` at the root layout and use `clerkMiddleware`/`createRouteMatcher` for route protection. Clerk backend token verification guidance covers session JWT input from `__session` or `Authorization: Bearer`, public-key/JWKS verification, and authorized-party checks for expected frontends.

## Ambiguity Policy

Use the 7-dimension `/dev` decision gate.

- 0-3: proceed and document in the decisions log.
- 4-7: route to spec review before implementation.
- 8+, auth exposure, schema migration, or public API removal: block for developer input.

Any change that grants access, changes identity mapping, introduces schema migrations, or weakens redirect validation is automatically blocked unless this design is updated first.
