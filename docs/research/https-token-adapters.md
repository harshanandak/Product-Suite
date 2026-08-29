# HTTPS token adapters research

Date: 2026-08-30

## Scope verified

- `apps/platform-web/src/env.ts` documents exact-empty `API_BASE_URL` as the Vite proxy or co-hosted same-origin mode.
- Repository-wide caller search found seven token-bearing factory seams in the assigned source inventory: items, meeting actions, agent threads, agent chat, memories, memory impact, and proposals.
- `apps/platform-web/src/data/proposals/network-repository.ts` contains the only existing inline HTTPS check.

## Threat decision

The protected boundary is bearer-token transport. A non-empty configured API base must be an absolute HTTPS URL without username or password fields. Exact empty remains allowed for relative same-origin URLs. Private and loopback absolute HTTPS remain allowed because SSRF is outside this browser-origin change; HTTP loopback remains rejected. Redirect behavior stays browser and CORS owned.

## Technical approach

Reuse the platform `URL` parser in one exported `assertSecureApiBaseUrl` function in `apps/platform-web/src/env.ts`. Invoke it synchronously immediately after each factory resolves its base URL and before any token resolution or fetch. Replace the proposal adapter's inline check. Add no dependency or additional abstraction.

## TDD scenarios

1. Each factory accepts a normal absolute HTTPS base and retains its existing token/fetch behavior.
2. Each documented relative-mode factory accepts exact empty and constructs the existing same-origin `/api/*` URL.
3. Each factory synchronously rejects HTTP including localhost, FTP, protocol-relative, malformed, whitespace-only, and credential-bearing values before token resolution or fetch.
4. Private and loopback absolute HTTPS bases remain accepted.
5. Missing tokens retain each adapter's existing bearer-less or local signed-out behavior.

## Risks

- Validating after token resolution would leave the cleartext-token side effect reachable.
- Treating whitespace as empty would create an undocumented second relative mode.
- Expanding into redirect or SSRF policy would widen this focused browser transport fix.
