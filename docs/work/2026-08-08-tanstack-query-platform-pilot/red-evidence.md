# Reconstructed RED evidence

This file records **RECONSTRUCTED** counterfactual RED evidence for Tasks 1–4.
These runs were performed after implementation because the original RED command
output was not persisted. They demonstrate that each test delta fails without
its implementation delta, but they do not prove test-first chronology and must
not be used as TDD gate evidence. The missing original RED transcripts are an
irrecoverable evidence gap; these runs are not represented as historical output.

Each run used a disposable detached worktree at the task's parent commit. Only
that task's test delta was checked out from its implementation commit; the
corresponding implementation delta was absent. Task 1 also included the later
auth-scope integration test delta so the reviewer-requested behavior was
exercised against the pre-Task-1 state.

## Task 1 — scoped server-state boundary

- Parent: `9c992bccacf9168cdd88b24caa042168ba31d314`
- Test delta: `ServerStateProvider.test.tsx` and `index.test.ts` from
  `275daac0b4f5a4072814f64a8dfe1db43137df37`, plus
  `scope-switch.integration.test.tsx` from
  `9f440aec667cccc1d6439f733ad8d897f3cd8a58`
- Command:
  `bun x vitest run src/data/server-state/ServerStateProvider.test.tsx src/data/server-state/index.test.ts src/data/server-state/scope-switch.integration.test.tsx --reporter=verbose`
- Exit: `1`
- Expected failure excerpts: `Failed to resolve import "./index" ... Does the file exist?`
  and `Failed to resolve import "./ServerStateProvider" ... Does the file exist?`
- Result: `3 failed suites`; no tests ran because the provider boundary did not
  yet exist.

## Task 2 — cancellable, status-aware adapter

- Parent: `275daac0b4f5a4072814f64a8dfe1db43137df37`
- Test delta: `adapter.test.ts` from
  `85cff677fc8cdc917b6841ff503604d4ecb1e6dc`
- Command:
  `bun x vitest run src/data/memory-impact/adapter.test.ts --reporter=verbose`
- Exit: `1`
- Expected failure excerpts: `expected Error: Unauthorized to match object`
  with missing `status: 401`; `expected false to be true` for composed caller
  cancellation; caller abort received `TimeoutError` instead of `AbortError`;
  and the 503 error lacked `status: 503`.
- Result: `4 failed | 3 passed`.

## Task 3 — Query-backed read hook

- Parent: `85cff677fc8cdc917b6841ff503604d4ecb1e6dc`
- Test delta: `use-memory-impact.test.ts` from
  `14aba1d2662fb374dcf52ee4fa5f2db71eb8e288`
- Command:
  `bun x vitest run src/data/memory-impact/use-memory-impact.test.ts --reporter=verbose`
- Exit: `1`
- Expected failure excerpts: the adapter received no `AbortSignal`;
  `expected "get" to be called 1 times, but got 2 times`; the cancellation
  signal was `undefined`; and the transient network failure never retried to
  produce `savedEdits: 5`.
- Result: `4 failed | 5 passed`.

## Task 4 — application-root wiring

- Parent: `14aba1d2662fb374dcf52ee4fa5f2db71eb8e288`
- Test delta: `AppRoot.test.tsx` from
  `149f5b0c4cf59d137349d3532ab529c45fe874d0`
- Command:
  `bun x vitest run src/AppRoot.test.tsx --reporter=verbose`
- Exit: `1`
- Expected failure excerpt: `Unable to find an element by:
  [data-testid="server-state-provider"]` in both fixtures/preview and the
  Clerk-gated application tree.
- Result: `2 failed | 3 passed`.

## Cleanup and GREEN verification

The disposable worktrees were named `red-evidence-t1-qpilot` through
`red-evidence-t4-qpilot`. Their explicit resolved paths were checked to be
children of the repository's `.worktrees` directory before cleanup. Git's
first removal unregistered Task 1 but left dependency-junction residue on
Windows; the validated `red-evidence-*` directories were therefore cleaned up
directly and the worktree metadata was pruned. `git worktree list --porcelain`
returned no reconstructed-evidence registration and `Test-Path` returned
`False` for all four paths.

Current-head GREEN evidence is recorded in the Forge issue handoff: the focused
platform-web suite passes, including the real `ServerStateProvider` +
`useMemoryImpact` scope-switch integration, and platform-web typecheck passes.
