# TanStack Query platform-web pilot — TDD tasks

Plan: [`plan.md`](./plan.md)
Forge issue: `5a03773c-b0df-4b96-9215-b2a0c9cd4031`

Only `useMemoryImpact` migrates. The four implementation tasks are sequential waves so each task has one owner and each RED-GREEN-REFACTOR loop can be reviewed before the next begins. Workspace-wide lint, typecheck, full-suite, and build evidence belongs to the separate VALIDATE stage recorded in `plan.md`, not to a no-owner DEV task.

## Task 1: Add the authorization-scoped server-state boundary

Wave: 1
OWNS: `apps/platform-web/package.json`, `bun.lock`, `apps/platform-web/src/data/server-state/ServerStateProvider.tsx`, `apps/platform-web/src/data/server-state/ServerStateProvider.test.tsx`, `apps/platform-web/src/data/server-state/index.ts`, `apps/platform-web/src/data/server-state/index.test.ts`

What to implement: Declare `@tanstack/react-query` in `platform-web` using the canonical root resolution. Add the smallest server-state module that constructs QueryClient instances, exposes the current non-secret authorization scope, allocates stable primitive adapter ids with a module-local `WeakMap<object, number>`, and defines the bounded retry predicate. Fixture mode must never invoke Clerk. Authenticated mode derives scope from Clerk `userId` and active `orgId`; a change to either synchronously selects a fresh QueryClient. Configure memory-only caching only—no persistence/broadcast/offline plugin. The retry predicate is structural and generic: it may inspect only standard error shape/name/status, never import a Task 2 adapter error class.

TDD steps:

1. Write test: in `ServerStateProvider.test.tsx`, first assert fixture mode renders children without `useAuth`; authenticated mode exposes a scope containing user/org identifiers; same scope reuses its client; changing user or org supplies a new empty client; neither scope nor serialized query keys contain a mocked bearer token. Prove the adapter-id allocator returns the same primitive id for the same object and a different id for a replacement. Unit-test structural retry classification with plain shaped values: `AbortError` and numeric 4xx return false; `TypeError`, `TimeoutError`, and numeric 5xx allow only one retry; unknown errors do not retry.
2. Run test: confirm RED because `ServerStateProvider`/retry policy and the platform dependency do not exist.
3. Implement: add the dependency, provider/context, QueryClient factory, explicit cache defaults, synchronous scope-to-client selection, and retry predicate. Do not import any repository or product protocol into the generic module.
4. Run test: confirm the new provider suite passes; run package typecheck to prove Clerk/Query types are correct.
5. Refactor: remove any duplicated provider branch logic while retaining the rule that fixture mode cannot call Clerk.
6. Commit: `feat(platform-web): add scoped server-state boundary`

Expected output: provider tests prove cache isolation and secret-free scope identity; `bun run --cwd apps/platform-web typecheck` exits 0; root lock resolves one canonical Query version.

## Task 2: Make the memory-impact adapter cancellable and retry-classifiable

Wave: 2
OWNS: `apps/platform-web/src/data/memory-impact/adapter.ts`, `apps/platform-web/src/data/memory-impact/adapter.test.ts`

What to implement: Extend only `MemoryImpactAdapter.get` to accept an optional caller abort signal. Compose it with the existing 15-second timeout. Preserve API error-message extraction while exposing HTTP status in a typed request error so Task 1's retry predicate can classify 4xx/5xx without parsing message text.

TDD steps:

1. Write test: add assertions that `get(window, signal)` forwards a composed signal to fetch, caller abort rejects with an abort-like error, timeout remains present, a 401 error retains `Unauthorized` plus status 401, and a 503 retains status 503.
2. Run test: confirm RED because `get` accepts no signal and current errors expose no status.
3. Implement: add the optional signal, compose caller cancellation with timeout using platform abort primitives, and introduce the smallest exported typed/status-bearing error needed by retry policy. Keep bearer and `org_id` behavior unchanged.
4. Run test: confirm all adapter tests pass, including existing bearer/window/org/error-message assertions.
5. Refactor: keep request construction in the adapter; do not move fetch/auth logic into Query or the hook.
6. Commit: `feat(platform-web): propagate memory impact cancellation`

Expected output: adapter tests demonstrate caller cancellation, timeout preservation, and stable status classification without exposing tokens.

## Task 3: Migrate only `useMemoryImpact` to TanStack Query

Wave: 3
OWNS: `apps/platform-web/src/data/memory-impact/use-memory-impact.ts`, `apps/platform-web/src/data/memory-impact/use-memory-impact.test.ts`

What to implement: Replace the hook's manual state/effect/mounted-ref loop with `useQuery` against the existing adapter. Include authorization scope, window, and the primitive id returned by Task 1's WeakMap allocator in cache identity; never serialize or insert the adapter object itself. Pass Query's signal into `adapter.get`. Preserve the exact public result names and injected-adapter precedence/adapter-swap behavior. Do not migrate any sibling hook.

TDD steps:

1. Write test: retain existing happy/error/window/adapter-swap assertions and add cache-dedupe for two consumers in the same scope, no reuse across scope change, abort on final observer unmount/scope switch, no retries for 401/abort, and at most one retry for transient network/503 errors.
2. Run test: confirm RED because the manual hook neither deduplicates/cache-scopes requests nor passes cancellation to the adapter.
3. Implement: call `useQuery` with the server-state client/scope, an adapter-backed `queryFn({ signal })`, and a query key that contains no token. Map Query state back to `{ impact, loading, error }` without widening the public API.
4. Run test: confirm all hook tests pass and no sibling data hook changed.
5. Refactor: keep query-specific code local to the hook and generic cache/security policy in `server-state`.
6. Commit: `refactor(platform-web): query memory impact server state`

Expected output: the hook preserves current rendering behavior while deduplicating same-scope reads, isolating authorization scopes, and cancelling unused requests.

## Task 4: Mount the boundary in both AppRoot modes

Wave: 4
OWNS: `apps/platform-web/src/AppRoot.tsx`, `apps/platform-web/src/AppRoot.test.tsx`

What to implement: Mount `ServerStateProvider` at the stable application boundary in both fixture and authenticated branches, inside Clerk where authentication is present and above `MemoryImpactProvider`/Router. The no-Clerk-key setup notice remains outside server-state infrastructure.

TDD steps:

1. Write test: extend `AppRoot.test.tsx` to assert fixture mode mounts the fixture server-state boundary without Clerk; authenticated mode mounts Clerk then the authenticated boundary above Router; setup-notice mode mounts neither; simulated user/org scope changes replace the client before a child query can observe old cache.
2. Run test: confirm RED because AppRoot has no server-state boundary.
3. Implement: add the provider in the two existing branches with no router or repository reordering beyond the required stable boundary.
4. Run test: confirm AppRoot and focused memory-impact suites pass.
5. Refactor: if nesting duplication is reduced, preserve the explicit fixture/Clerk separation and keep the diff local.
6. Commit: `feat(platform-web): mount query boundary in app root`

Expected output: fixture and authenticated app trees both support `useMemoryImpact`; setup mode is unchanged; no Clerk hook executes in fixture mode.

## YAGNI review

- Task 1 maps to success criteria 1, 3, 4, 6, and 7.
- Task 2 maps to success criteria 5 and 6.
- Task 3 maps to success criteria 2–6 and the single-hook constraint.
- Task 4 maps to success criteria 1 and 4 plus the fixture/auth edge cases.
- No task adopts a deferred TanStack package, migrates another hook, adds cache persistence, changes realtime/run authority, or generalizes beyond the pilot.
