# TanStack Query platform-web pilot — DEV decisions

## Decision 1

**Date**: 2026-08-08
**Task**: Task 1 — Add the authorization-scoped server-state boundary
**Gap**: The task owned a new `server-state/index.ts` barrel but did not list the matching `index.test.ts` required by `check:source-test`.
**Score**: 2/14 (one additional in-module test file; no API, schema, behavior, auth, or reversibility impact)
**Route**: PROCEED
**Choice made**: Add a focused barrel-export test. Delete the prematurely created barrel, prove the test RED on the missing module, then restore the barrel and prove GREEN.
**Status**: RESOLVED
