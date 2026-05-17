# PR6 Auth Provider Rollout Design

Feature: pr6-auth-provider-rollout
Date: 2026-05-16
Issue: product-suite-fto
Status: planning
Classification: critical

## Purpose

Move Product-Suite to one canonical identity-provider model after PR5 introduced shared auth claims and adapters. The target is Neon/Better Auth as the canonical hosted identity source across meeting-web, roadmap-web, and meeting-api, without losing existing tenant/workspace authorization behavior.

## Success Criteria

- Roadmap route protection no longer uses Supabase Auth as the source of truth.
- Meeting-web and roadmap-web can both map canonical hosted sessions into PR5 `AuthClaims`.
- Meeting-api verifies the same canonical hosted token shape through JWKS/OIDC settings.
- Supabase remains available only as roadmap data/storage/realtime infrastructure, not the app-auth foundation.
- Existing auth, onboarding, team/workspace, and API validation tests still pass.
- Docs and env examples clearly name the canonical provider, JWKS URL, issuer/audience settings, callback URL expectations, and rollback path.

## Out Of Scope

- PR7 typed SDK/client extraction.
- PR8+ UI block extraction.
- Full Supabase database ownership migration.
- Deleting Supabase as a database, storage, or realtime dependency.
- Rewriting all roadmap data access to a new backend service.
- Introducing a second identity provider.

## Approach Selected

Use a compatibility-first rollout instead of a blind provider swap.

PR6 will introduce a roadmap canonical-auth facade and move route/session truth to Neon/Better Auth while preserving Supabase data-client behavior where RLS still depends on `auth.uid()`. The reason is verified in `apps/roadmap-web/supabase/migrations`: many policies still depend on Supabase JWT identity. Replacing login without preserving those authorization semantics would cause data access regressions.

The implementation should convert auth truth in narrow layers first:

1. Shared contracts: reuse PR5 `AuthClaims`.
2. Roadmap shell: add canonical session helpers and middleware checks.
3. Roadmap Supabase: keep data client creation intact; document and test any RLS bridge assumptions.
4. Meeting API: keep the existing JWKS verifier boundary and make canonical provider config explicit.
5. Docs/env: update launch and rollback instructions.

## Constraints

- Do not make Supabase Auth and Neon/Better Auth both long-term app-auth truths.
- Do not bypass authorization checks with broad service-role access unless every affected route performs equivalent app-level membership checks.
- Do not change RLS policies without tests proving team/workspace isolation still holds.
- Do not store provider tokens in logs, error payloads, or shared claims.
- Keep public feedback/review routes public where they are currently public.
- Keep OSS/local meeting-api mode working.

## Edge Cases

- Missing hosted session: protected roadmap routes redirect to `/login`; public routes remain accessible.
- Missing workspace claim: workspace-protected paths fail closed with `WORKSPACE_ACCESS_DENIED` or equivalent redirect.
- Expired token: web shell clears/refreshes canonical session; meeting-api returns 401 with `WWW-Authenticate: Bearer`.
- JWKS unavailable: meeting-api rejects hosted tokens without falling back to unsigned/local hosted acceptance.
- Supabase data call needs `auth.uid()`: keep existing data-client/session bridge until that path has app-level membership checks or an RLS-compatible canonical JWT.
- Callback origin mismatch: fail closed and document trusted-origin/callback configuration.

## Ambiguity Policy

Use the /dev 7-dimension rubric. If a decision is at least 80 percent confident and preserves existing authorization behavior, proceed and document it in the decisions log. If confidence is below 80 percent, stop and ask before changing auth, RLS, token, or callback behavior.

## Technical Research

See `docs/research/pr6-auth-provider-rollout.md`.

OWASP notes:

- A01 Broken Access Control: high relevance. Mitigation: preserve team/workspace checks, fail closed on missing claims, and test multi-tenant access.
- A02 Cryptographic Failures: high relevance. Mitigation: use JWKS verification with issuer/audience and required claims; no unsigned token fallback.
- A05 Security Misconfiguration: high relevance. Mitigation: document exact `BETTER_AUTH_URL`, trusted origins, callback URLs, JWKS URL, issuer, and audience.
- A07 Identification and Authentication Failures: high relevance. Mitigation: centralize session reads and bearer-token verification; clear expired sessions.
- A09 Security Logging and Monitoring Failures: medium relevance. Mitigation: log non-sensitive auth failure categories only.

TDD scenarios:

- Happy path: roadmap canonical session maps to `AuthClaims`, protected routes pass, workspace claim resolves.
- Failure path: missing/expired hosted session redirects or returns 401 without Supabase `auth.getUser()` as fallback truth.
- Edge path: Supabase data access that still requires `auth.uid()` remains documented and tested through the bridge.
- Backend path: meeting-api hosted bearer token verifies using JWKS, issuer, audience, and required claims.
- Rollback path: config can restore previous roadmap Supabase Auth route gate while preserving PR5 contracts.
