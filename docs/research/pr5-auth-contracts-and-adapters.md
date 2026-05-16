# PR5 Auth Contracts And Adapters Research

Date: 2026-05-16
Issue: product-suite-ef5

## Source Plan

`docs/plans/building-blocks-transformation-pr-plan.md` defines PR5 as the auth-contracts step before PR6 provider rollout:

- Goal: unify auth shape before changing providers.
- Required contracts: `AuthClaims`, `TokenVerifier`, `SessionBridge`, `WorkspaceAccessResolver`.
- Hard boundary: do not change the login provider in PR5.
- Merge gate: current auth flows still work while sharing one claims model.

## Current Repo Findings

- `packages/contracts` is the right home for shared JS/TS contract artifacts. It already exports `identityScopeContract`, `conversationContract`, `meetingCoreContract`, and `canvasCoreContract`.
- `packages/contracts/src/index.test.ts` validates contract JSON artifact parity and export shape. PR5 should follow that pattern for auth contracts.
- `apps/roadmap-web/src/middleware.ts` delegates to `apps/roadmap-web/src/lib/supabase/middleware.ts`; that file refreshes Supabase sessions and redirects unauthenticated protected routes.
- `apps/roadmap-web/src/lib/middleware/permission-middleware.ts` owns workspace/permission checks and is the roadmap-side source for workspace access behavior.
- `apps/meeting-web/src/lib/api.js` owns hosted auth URL resolution, token/session retrieval, and API Authorization header behavior.
- `apps/meeting-api/backend/security.py` owns hosted-claims normalization, token creation/decode, and actor creation from credentials.

## External Security Guidance

- OWASP Authentication Cheat Sheet: authentication failures are high-risk, so PR5 should keep provider behavior stable and add compatibility tests before provider changes.
  Source: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: session identifiers/tokens must be treated as sensitive auth material and not weakened by adapter normalization.
  Source: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OpenID Connect Core: provider rollout later must validate issuer/audience/expiry/signature semantics; PR5 should model these fields without hardcoding one provider.
  Source: https://openid.net/specs/openid-connect-core-1_0-final.html
- RFC 7519 JWT: registered claims such as `iss`, `sub`, `aud`, `exp`, `iat`, and `jti` are standard vocabulary for the shared claims model.
  Source: https://datatracker.ietf.org/doc/html/rfc7519.html

## OWASP Notes For PR5

- A01 Broken Access Control: `WorkspaceAccessResolver` must preserve tenant/workspace boundaries and avoid implicit access.
- A02 Cryptographic Failures: `TokenVerifier` must describe verification outputs without bypassing signature/expiry checks in implementations.
- A04 Insecure Design: adapters must be boundary wrappers, not a permanent dual-auth truth system.
- A07 Identification and Authentication Failures: shared `AuthClaims` must represent all current flows without inventing a weaker fallback.
- A09 Logging and Monitoring Failures: failure objects should be machine-readable enough to log without exposing tokens.

## TDD Scenarios

1. Contract package exports `authContracts` with required keys for claims, verifier, session bridge, and workspace access resolver.
2. Contract package rejects or flags missing required claim fields such as provider, subject, and tenant/workspace context.
3. Meeting API can normalize existing hosted claims into the shared shape without changing token acceptance behavior.
4. Meeting web can map hosted session/token state into the shared session bridge shape without changing API request behavior.
5. Roadmap web can expose a Supabase-backed session bridge shape without changing middleware redirects.

## Selected Scope

PR5 should create the shared contract vocabulary and low-risk adapter helpers with tests. It must not switch roadmap-web away from Supabase Auth, must not replace meeting-web hosted auth, and must not migrate meeting-api verification to a new IdP. That belongs to PR6.
