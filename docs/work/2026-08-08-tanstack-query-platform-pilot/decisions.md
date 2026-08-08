# TanStack Query platform-web pilot — DEV decisions

## Decision 1

**Date**: 2026-08-08
**Task**: Task 1 — Add the authorization-scoped server-state boundary
**Gap**: The task owned a new `server-state/index.ts` barrel but did not list the matching `index.test.ts` required by `check:source-test`.
**Score**: 2/14 (one additional in-module test file; no API, schema, behavior, auth, or reversibility impact)
**Route**: PROCEED
**Choice made**: Add a focused barrel-export test. Delete the prematurely created barrel, prove the test RED on the missing module, then restore the barrel and prove GREEN.
**Status**: RESOLVED

## Decision 2

**Date**: 2026-08-08
**Task**: Quality correction — auth-scope observer ownership
**Gap**: Passing a replacement client to `useQuery` did not reconstruct its existing observer, so results for scope B could be written into scope A's client.
**Score**: 4/14 (security-sensitive cache ownership and lifecycle behavior; localized, testable, and reversible inside the server-state boundary)
**Route**: SPEC-REVIEWER correction
**Choice made**: Key the entire context and Query provider subtree by authorization scope. A scope departure unmounts its observers and clears its client; returning A after A→B→A creates a fresh A client and refetches rather than retaining a departed-scope cache.
**Status**: RESOLVED
