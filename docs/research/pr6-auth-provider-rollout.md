# PR6 Auth Provider Rollout Research

Date: 2026-05-16
Issue: product-suite-fto
Status: planning

## Goal

PR6 moves Product-Suite from split auth foundations to one canonical identity-provider model while preserving the PR5 shared `AuthClaims` shape. PR6 must not change product authorization behavior accidentally.

## Current Code Findings

- `apps/meeting-web/src/lib/api.js` already initializes hosted Neon/Better Auth through `@neondatabase/neon-js/auth` and `@neondatabase/neon-js/auth/react/adapters`.
- `apps/meeting-api/backend/services/neon_auth.py` already verifies Neon Auth JWTs with JWKS using `PyJWKClient`, issuer checks, audience checks, and required `sub`, `exp`, `iat`, `iss`, and `aud` claims.
- `apps/meeting-api/backend/security.py` already routes hosted bearer tokens through `decode_neon_access_token(..., jwks_url=NEON_JWKS_URL)`.
- `apps/roadmap-web/src/middleware.ts` delegates route protection to `apps/roadmap-web/src/lib/supabase/middleware.ts`.
- `apps/roadmap-web/src/lib/supabase/middleware.ts` uses `createServerClient(...).auth.getUser()` as the route-auth truth.
- `apps/roadmap-web/src/lib/supabase/server.ts` uses Supabase SSR cookie handling for Server Components and Route Handlers.
- `apps/roadmap-web/src/lib/auth-contracts.ts` maps a Supabase user into shared `AuthClaims`, which was useful for PR5 compatibility but keeps Supabase Auth as the source.
- `apps/roadmap-web/supabase/migrations/*.sql` contains many RLS policies using `auth.uid()`. This is the highest-risk PR6 constraint: removing Supabase Auth without replacing the database authorization signal would break protected Supabase reads/writes.

## Documentation Findings

- Better Auth current setup uses `betterAuth(...)` server config, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, a mounted auth handler, and `createAuthClient({ baseURL })` for web clients. Better Auth security docs emphasize exact `trustedOrigins`.
- Supabase SSR current docs require explicit cookie `getAll`/`setAll` handlers for server clients and middleware. Even if Supabase stops being the auth truth, PR6 must preserve any cookie/data-client behavior still needed by roadmap-web.
- FastAPI current docs model bearer auth as reusable dependencies that validate a token, raise 401 with `WWW-Authenticate: Bearer`, and optionally chain into active-user/authorization dependencies. PR6 should keep token validation behind one dependency boundary.
- Neon docs describe JWKS as the standard way for services to verify JWTs and document Neon Auth/Better Auth as branchable auth with users, sessions, organizations, config, and JWKS stored under Neon Auth ownership.

## Architecture Constraint

The roadmap app cannot simply delete Supabase Auth calls in one pass. Its database policies still rely on `auth.uid()`. PR6 needs an explicit bridge strategy:

1. Canonical identity is Neon/Better Auth.
2. Web/session checks read canonical claims through a new roadmap auth facade.
3. Supabase remains a data/storage/realtime platform during PR6.
4. Any RLS-dependent operation must either continue to receive a database-recognized user identity or move behind server-side authorization using shared `AuthClaims`.

## Selected Direction

Use a compatibility-first rollout:

- Add a roadmap auth facade that returns shared `AuthClaims` from the canonical Neon/Better Auth session.
- Replace roadmap route-auth checks so app navigation no longer treats Supabase Auth as the source of truth.
- Keep Supabase data clients intact for data/realtime/storage access until each RLS-dependent path has a tested authorization bridge.
- Extend meeting-api config/tests around canonical JWKS/OIDC verification rather than inventing a second verifier.
- Update docs and env examples to make the canonical auth provider explicit.

## Launch Configuration

- Canonical provider: Neon/Better Auth.
- Meeting web: set `VITE_CANONICAL_AUTH_PROVIDER`, `VITE_BETTER_AUTH_URL`, and `VITE_BETTER_AUTH_TRUSTED_ORIGINS`.
- Roadmap web: set `ROADMAP_CANONICAL_AUTH_PROVIDER`, `ROADMAP_CANONICAL_AUTH_SECRET`, signed claims/signature cookie names, `ROADMAP_CANONICAL_AUTH_TRUSTED_ORIGINS`, and `NEXT_PUBLIC_BETTER_AUTH_URL`.
- Meeting API: set `CANONICAL_AUTH_PROVIDER`, `CANONICAL_AUTH_ISSUER`, `CANONICAL_AUTH_AUDIENCE`, and `CANONICAL_AUTH_JWKS_URL`; keep `NEON_AUTH_URL` as the hosted auth URL.
- Callback URLs and trusted origins must exactly match each deployed web origin. Do not rely on wildcard origins for hosted auth.
- rollback: restore the roadmap middleware import from `@/lib/supabase/middleware`, keep PR5 auth contracts in place, and leave Supabase data/RLS clients untouched while the canonical provider configuration is corrected.

## Primary Sources

- Better Auth setup and client docs: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/installation.mdx
- Better Auth security trusted origins docs: https://github.com/better-auth/better-auth/blob/main/docs/content/docs/reference/security.mdx
- Supabase SSR server client docs: https://github.com/supabase/ssr/blob/main/_apirefdocs/api-reference/create-server-client.md
- FastAPI OAuth2/JWT security docs: https://github.com/fastapi/fastapi/blob/master/docs/en/docs/tutorial/security/oauth2-jwt.md
- Neon Auth changelog / JWKS ownership: https://neon.com/docs/changelog/2025-12-12
- Neon JWT/JWKS authorization guide: https://neon.com/docs/guides/neon-rls-authorize-custom-jwt

## Open Risks

- Supabase RLS migration may require hosted database config or policy changes that cannot be safely inferred from code alone.
- Session continuity depends on currently provisioned Neon/Better Auth callback URLs and trusted origins.
- Roadmap API routes are numerous; PR6 should avoid converting every data path in one unreviewable commit.
