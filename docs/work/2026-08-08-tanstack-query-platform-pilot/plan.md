# TanStack Query platform-web pilot

## Feature

- Slug: `tanstack-query-platform-pilot`
- Date: 2026-08-08
- Status: SHIP-complete; awaiting review on PR #164
- Forge issue: `5a03773c-b0df-4b96-9215-b2a0c9cd4031`

## Purpose

Prove one safe, incremental use of TanStack Query in `platform-web` without turning TanStack into an application foundation. The pilot replaces the hand-built loading/cancellation loop in the read-only `useMemoryImpact` hook while keeping the memory-impact adapter, Clerk boundary, platform API, database, realtime transport, and product-owned agent run protocol authoritative.

TanStack Query is already used by `roadmap-web`; this work standardizes that existing utility choice rather than introducing a new product architecture.

## Success criteria

1. `platform-web` declares the canonical root-lock-compatible `@tanstack/react-query` dependency and mounts one QueryClient boundary in both fixture and authenticated application modes.
2. `useMemoryImpact` remains repository/adapter-backed and preserves its public `{ impact, loading, error }` behavior and injected-adapter test seam.
3. Cache identity includes a stable authorization scope derived from principal and active organization, never a bearer token or other credential.
4. A principal or organization change synchronously selects a fresh QueryClient/cache so no result can be reused across authorization scopes.
5. Query cancellation reaches the adapter's fetch signal while retaining the existing request timeout.
6. Retry is bounded: no retry for aborts or HTTP 4xx; at most one retry for transient network/HTTP 5xx failures.
7. The cache is memory-only. No persistence, offline cache, broadcast cache, service-worker cache, or server dehydration is added.
8. Focused tests, `platform-web` lint, typecheck, and tests pass without weakening a gate.

## Out of scope

- Migrating proposals, memories, meeting actions, teams, item checks, or composite `useWorkItems`.
- Replacing repository/adapter interfaces with Query-specific data access.
- Changing `RealtimeTransport`, proposal mutation events, database authority, tenant resolution, API contracts, or `agent_runs` lifecycle/run protocol.
- Adding SSR hydration to the Vite SPA or changing `roadmap-web`'s Next.js Query setup.
- Persisted/offline caching, cross-tab broadcasting, speculative prefetching, Query Devtools, or a generalized query-key factory for domains not in this pilot.
- Adopting TanStack AI, DB, Charts, or Start.
- Dependency cleanup for separately declared but currently unused utilities.

## Approach selected

### Selected: `useMemoryImpact` with an authorization-scoped Query boundary

Add a small `server-state` module that owns QueryClient construction, retry policy, and authorization scope. The authenticated provider reads Clerk `userId` and `orgId`; the fixture provider uses a fixed fixture scope. A scope change creates a new client immediately instead of clearing the old client in a later effect. `useMemoryImpact` calls the existing adapter through `useQuery`, passing Query's abort signal into the adapter. Its public return shape stays unchanged.

This is the smallest useful pilot because memory impact is one read-only GET, already swaps adapters on org changes, has no write path, and owns no realtime subscription.

### Rejected alternatives

1. **Pilot `useTeams`:** rejected because it derives teams from the entire work-item list, silently handles errors, and shares the work-item repository's future realtime invalidation seam. It would blur the boundary with the explicitly deferred composite work-items migration.
2. **Pilot proposals or memories:** rejected because both include mutations and cross-instance invalidation. They are better follow-ups after cache isolation and retry/cancellation policy have been proven on a read-only query.
3. **Migrate all server-state hooks:** rejected as a big-bang architecture change with unnecessary regression and cache-authority risk.

## Constraints

- Product repositories/adapters remain the only browser-to-platform API seam; Query is orchestration/cache only.
- The platform API and server-side tenant checks remain authoritative. Client cache scope is defense in depth, not authorization.
- Tokens must be resolved per request and must never enter query keys, logs, persisted state, error messages, or test snapshots.
- Cache scope must include the signed-in principal and active org. `no-org` is a distinct scope, not a wildcard.
- Scope changes must not depend on an asynchronous cleanup effect.
- Query's abort signal and the existing 15-second timeout must be composed; neither may disable the other.
- Retry must be explicit and testable. Authentication/authorization failures and aborts are terminal.
- Existing fixture mode must not invoke Clerk hooks.
- No source change may weaken lint, typecheck, tests, security, or TDD gates.

## Edge cases

- **Signed out or token missing:** the adapter may issue an unauthenticated request and surface the API's 401; Query does not retry it.
- **Multiple organizations:** `orgId` is present in both the request and cache authorization scope. Switching orgs selects a fresh cache before child queries render.
- **Same org, different user:** `userId` prevents cross-principal cache reuse.
- **No active org:** use an explicit `no-org` scope; never reuse a prior org's client.
- **Rapid scope switch during an in-flight request:** the old observer unmounts, Query aborts its request, and the new scope reads through a fresh client.
- **Caller-provided adapter changes:** include adapter identity in the query key or otherwise force the query to use the new adapter; preserve the existing reactive swap behavior.
- **Non-JSON error response:** preserve the existing status fallback message and attach HTTP status for retry classification.
- **Fixtures/tests outside AppRoot:** retain a deterministic, non-authenticated fallback query client/scope only for the existing injected-adapter seam; production AppRoot always supplies the boundary.

## Ambiguity policy

Use the `/dev` seven-dimension decision rubric. At or above 80% confidence, choose the smallest behavior consistent with this plan and record it in `decisions.md`. Below 80%, stop and ask. Any ambiguity involving tenant isolation, cache lifetime across an identity change, token handling, retrying writes, or authority boundaries is automatically below 80%.

## Technical research

### Current code and DRY findings

- `apps/roadmap-web/src/app/providers.tsx` already demonstrates the repository's QueryClient/Provider convention, but its broad client-only defaults are not copied blindly.
- `apps/platform-web/src/data/memory-impact/use-memory-impact.ts` currently owns `useState`, mounted/cancelled guards, loading, and error state around `adapter.get(windowDays)`.
- `apps/platform-web/src/data/memory-impact/adapter.ts` already owns Clerk bearer resolution, active-org request scoping, error extraction, and a 15-second `AbortSignal.timeout`.
- `apps/platform-web/src/data/memory-impact/MemoryImpactProvider.tsx` deliberately separates fixture mode from the Clerk-backed provider and already reacts to token/org changes through refs.
- `apps/platform-web/src/AppRoot.tsx` mounts every repository provider above Router in both fixture and authenticated branches. The Query boundary belongs at the same stable level.
- Canonical dependency evidence is the root `bun.lock`, which resolves `@tanstack/react-query@5.99.0`; `apps/roadmap-web/bun.lock` is stale and is not authority.

### Cache and authorization design

Use a short immutable scope value containing mode, `userId`, and `orgId`, but never `getToken()` output. Construct a new QueryClient synchronously when that scope changes. The memory-impact query key includes the authorization scope, requested window, and a primitive adapter identity allocated by a module-local `WeakMap<MemoryImpactAdapter, number>`. The same adapter object always receives the same process-local id; a replacement adapter always receives a different id. Query keys never contain or serialize the adapter object. This gives defense in depth even though each authorization scope owns a separate client.

No cache persistence plugin is allowed. Use finite `staleTime`/`gcTime` suitable for a small read-only card; exact values are implementation constants tested through behavior, not product architecture. Window-focus refetch remains explicit rather than inherited from `roadmap-web`.

### Cancellation and retry design

Extend `MemoryImpactAdapter.get` to accept an optional caller `AbortSignal`. Compose it with `AbortSignal.timeout(15_000)` using platform abort primitives. Preserve the existing message behavior and add a typed/status-bearing request error. The shared retry predicate remains structurally decoupled from that class: it reads only error shape (`name`, numeric `status`, and standard `TypeError`/`TimeoutError` network signals), never imports the adapter error. `AbortError` and 4xx never retry; `TypeError`, `TimeoutError`, and 5xx retry once; all other shapes stop.

### OWASP analysis

- **A01 Broken Access Control — applies:** stale cached tenant data could appear after a user/org switch. Mitigation: server authorization remains authoritative, keys include principal/org scope, and a scope switch synchronously creates a fresh QueryClient.
- **A02 Cryptographic Failures — applies indirectly:** bearer tokens are secrets. Mitigation: resolve tokens only inside the adapter per request; never include them in keys, persistence, logs, fixtures, or snapshots.
- **A03 Injection — low relevance:** the existing adapter uses `URLSearchParams`; retain it. Query does not build SQL or interpolate request URLs itself.
- **A04 Insecure Design — applies:** asynchronous cache clearing can briefly expose old data. Mitigation: change client identity synchronously with authorization scope and test the transition.
- **A05 Security Misconfiguration — applies:** default retries could amplify unauthorized requests. Mitigation: explicit bounded retry policy with 4xx/abort exclusions.
- **A07 Identification and Authentication Failures — applies:** signed-out/no-org states must not inherit authenticated cache. Mitigation: distinct explicit scopes and fresh clients.
- **A08 Software and Data Integrity Failures — applies at dependency boundary:** use the existing root lock and normal Bun/Lefthook gates; do not trust stale app-local locks or bypass hooks.
- **A09 Security Logging and Monitoring Failures — limited:** no new logging is required; errors must not add credentials. Existing API/run observability remains owned server-side.
- **A10 SSRF — not introduced:** endpoint origin remains the configured product API base and is not query/user controlled.

### TDD scenarios

1. **Happy path:** under an authenticated `userId`/`orgId` scope, `useMemoryImpact` returns the adapter result, passes the window and abort signal, and preserves `{ impact, loading, error }`.
2. **Authorization edge:** switching org or principal produces a new client and no old cached result renders; keys contain scope identifiers but no bearer token.
3. **Cancellation:** unmount/scope switch aborts the in-flight adapter request while the adapter's timeout remains active.
4. **Failure:** HTTP 401/403 and abort errors execute once; a network/HTTP 5xx error executes at most twice total, then surfaces through `error` with `impact` unchanged/null as appropriate.
5. **Fixture mode:** AppRoot renders Router with the fixture Query boundary without mounting Clerk; authenticated mode mounts the Clerk-derived boundary above Router.
6. **Adapter swap:** rerendering with a different injected adapter cannot reuse the first adapter's cached result.

## Baseline evidence

- Base: `origin/main` at `42e30d88bc516dc6472c9f1bb837bd694844aa47`.
- `bun install --frozen-lockfile`: passed, 1,870 installs checked, no lock changes.
- Focused memory-impact/AppRoot baseline: 4 files and 15 tests passed.
- `apps/platform-web` lint: passed.
- `apps/platform-web` typecheck: passed.
- Full `apps/platform-web` test: passed, 108 files and 1,091 tests in 216.44 seconds. Existing non-failing React `act(...)` and jsdom canvas/OffscreenCanvas diagnostics were observed; they predate this docs-only branch and are outside the pilot.

## Coordination evidence

- `scripts/conflict-detect.sh`: no indexed conflicts; the kernel-only issue is not yet in its compatibility file index.
- `scripts/pr-coordinator.sh merge-sim`: clean against `main`.
- `scripts/dep-guard.sh check-ripple`: unavailable for this kernel-only issue (`Failed to show issue`); no dependency mutation made.
- `scripts/pr-coordinator.sh merge-order`: global pre-existing dependency cycle prevents queue ordering; no direct conflict with this branch was reported.
- Stale-worktree report was informational only; no other worktree was touched.
- Forge PLAN adapter mismatch: `forge plan tanstack-query-platform-pilot` requires a legacy standalone research document, while the current skill embeds research here. The current skill contract was followed manually.

## Plan review checklist

- Exactly one server-state hook migrates: `useMemoryImpact`.
- No mutation or realtime ownership moves into Query.
- Cache identity and scope-switch behavior are specified as security requirements.
- Four TDD implementation tasks have exact file ownership and no overlapping files within a wave.
- Implementation, validation beyond baseline, push, PR, and merge remain separate explicitly authorized stages.

## VALIDATE-stage handoff checklist

After Tasks 1–4 complete and receive independent spec/quality review, the separate `/validate` stage owns workspace evidence. On the final DEV head it must run the focused provider/adapter/hook/AppRoot tests, `platform-web` lint, typecheck, full tests, and production build; inspect the diff for token-bearing keys or persistence/offline plugins; and report unrelated failures without folding them into this DEV scope.

## Validation evidence

- Validated head: `870c8e78383ad46044b11d7f86a7c27b25a52a3b`, clean and zero commits behind `origin/main` at `42e30d88bc516dc6472c9f1bb837bd694844aa47`.
- Focused pilot suite: 9 files and 46 tests passed.
- Full `platform-web` suite: 113 files and 1,122 tests passed.
- `platform-web` typecheck, strict ESLint with zero warnings, and production Vite build passed.
- Source-test coupling covered all 23 changed files with zero missing tests; `git diff --check` passed.
- `bun audit --audit-level=critical` passed. The root audit reported 113 existing non-critical advisories (43 high, 58 moderate, 12 low).
- OWASP/manual diff review found no credential-bearing query key, persistence/offline cache integration, or change to repository, realtime, API tenant, database, or run-protocol authority.
