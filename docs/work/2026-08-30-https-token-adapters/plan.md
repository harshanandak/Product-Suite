# HTTPS token adapters

- Feature: `https-token-adapters`
- Date: 2026-08-30
- Status: locked for implementation
- Issue: `0efd4465-5827-4ca6-b1a3-ed3061c00091`

## Purpose

Prevent Clerk bearer tokens from being sent to a cleartext, malformed, or credential-bearing configured API origin in any platform-web network adapter.

## Success criteria

- All seven token-bearing adapter factories synchronously reject every non-empty API base that is malformed, non-HTTPS, protocol-relative, or contains URL credentials.
- Rejection happens before token resolution or `fetch`.
- Exact `""` remains valid for adapters that intentionally build same-origin `/api/*` URLs for Vite proxy and co-hosted deployments.
- Absolute HTTPS origins, including private and loopback hosts, remain valid.
- Existing signed-out behavior remains unchanged.
- One shared guard and one table-driven conformance test cover the complete seven-factory inventory.

## Out of scope

- Redirect enforcement, which remains browser and CORS owned.
- SSRF restrictions on private or loopback HTTPS hosts.
- Server, contract, deployment, or proxy changes.
- Refactoring the adapters' existing request primitives.

## Approach selected

Add `assertSecureApiBaseUrl` to `apps/platform-web/src/env.ts` using the platform `URL` parser. Call it immediately after each factory resolves its base URL, replacing the proposal adapter's inline check. No dependency or additional abstraction is needed.

## Constraints

- Preserve the exact empty-string same-origin mode; whitespace is not empty.
- Reject HTTP even for localhost and loopback IPs.
- Validate synchronously before any token or network side effect.
- Keep all existing valid and missing-token behavior intact.

## Edge cases

- Valid: `https://api.example.com`, private/loopback absolute HTTPS, and exact `""` where the factory builds a relative URL.
- Invalid: HTTP including localhost, FTP and other schemes, protocol-relative URLs, malformed values, whitespace-only values, and URLs with a username or password.

## Technical research

- DRY: the proposal repository has the only existing inline HTTPS check; replace it with the shared seam rather than duplicating it seven times.
- Platform: the standard `URL` constructor provides absolute parsing, protocol, username, and password fields.
- OWASP: this addresses cleartext bearer-token transport and credential-bearing authority confusion. It does not expand into SSRF or redirect policy.
- TDD scenarios: valid HTTPS preserves token/fetch behavior; exact empty base preserves same-origin behavior; every invalid class rejects before token/fetch; missing tokens preserve bearer-less requests.

## Ambiguity policy

Use the `/dev` seven-dimension decision rubric. Proceed only at 80% or greater confidence and record the decision; otherwise stop for specification review.
