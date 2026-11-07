# DB Contract redundant prepare reduction

## Outcome

Reduce the required DB Contract lane from seven transactional branch prepare lifecycles to five while preserving its 9-file, 57-test, zero-skip evidence contract.

## Design

`accept-path.test.ts` and `meeting-ingest.test.ts` each split transactional assertions around a dedicated-branch assertion. That creates a second transactional suite resource and repeats branch creation, role provisioning, migration replay, and cleanup.

Move each isolated transactional tail assertion into the file's existing transactional `describe`, before the dedicated assertions. Keep every dedicated assertion on `withDedicatedDbBranch`. The existing suite-scoped transaction, rollback, observer, branch lease, and deletion proof remain unchanged.

Add one AST-backed topology regression that requires every routed file with transactional assertions to instantiate exactly one transactional suite factory. The existing topology test continues to prove transactional and dedicated lifecycle scopes do not overlap.

## Constraints

- Keep all 57 assertions and their titles unchanged; no skips or timeout increases.
- Preserve dedicated branches for concurrency, committed retry/redrive, migration history, and least-privilege behavior.
- Keep independent sessions, rollback sentinels, branch cap, cleanup/deletion proof, rate-limit behavior, workflow gating, schema, auth, and product behavior unchanged.
- Add no dependency or framework and do not share a mutable test database across files.
- Limit the change to the two mixed DB Contract suites, the structural topology regression, and these work documents.

## Verification

1. RED: run the focused topology test and observe the new single-factory invariant fail for `accept-path` and `meeting-ingest`.
2. GREEN: reorder the two transactional tails, remove their extra factories, and rerun the focused topology and suite-resource unit tests locally.
3. Self-review against `CODING_STANDARDS.md`; inspect the final diff and count-lock evidence.
4. Real Neon acceptance is deferred to the lead: three consecutive runs on one final SHA, each 8-15 minutes, 9 files / 57 tests / 0 skips, no current-run branches remaining, and at most two active branches.

## Reverse path

Revert the focused commit to restore the prior test ordering and seven transactional prepare lifecycles. Real runs use only test-owned ephemeral Neon branches, whose existing teardown and final reap must prove deletion.
