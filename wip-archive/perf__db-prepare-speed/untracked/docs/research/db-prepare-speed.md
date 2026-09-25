# DB prepare speed: bounded source and timing review

Scope: tactical test-harness performance and measurement. Reviewed 2026-09-20/21 for Kernel issue `5210cc14-ad2c-444a-9ea1-a28a1a68cb64` and telemetry child `59c1ab1c-d0aa-41f6-b964-63c68da6d11d`.

## Evidence

The current implementation came from `e8cb748` and is rebased onto PR #191 merge `575afded`. The prerequisite lease-test changes from PR #187 must remain intact. The pre-rebase tip is preserved in `archive/db-prepare-before-191-20260921`.

`accept-path.test.ts` and `meeting-ingest.test.ts` each allocated a second transactional suite resource for a tail assertion. Moving those assertions into their existing transactional scope reduces transactional factories from seven to five. Dedicated concurrency assertions remain dedicated. `topology.test.ts` locks the single-factory invariant and lifecycle ordering.

`suite-resource.ts` already records create, prepare and delete phases. `harness.ts` performs dedicated branch create, role provisioning, schema preparation, seeding and strict teardown without equivalent lifecycle phase records. Reuse `measurePhase` from `telemetry.ts`; a new instrumentation framework is unnecessary.

Historical complete telemetry showed seven measured prepares consuming 474507–621307 milliseconds in aggregate. Removing two suggests 135600–177500 milliseconds less aggregate work, not a measured wall-clock saving because two workers overlap. Dedicated preparation is excluded from those totals. No optimized workflow result was available during the review.

GitHub DB Contract run [35508928341](https://github.com/harshanandak/Product-Suite/actions/runs/35508928341) took 21m47s: prerequisites 4m03s, runtime job 17m26s, required suite step 16m42s. This is a historical reference, not a controlled candidate comparison.

## Selected change

Retain the existing seven-to-five consolidation. Add existing phase telemetry around the dedicated lifecycle without changing allocation, preparation, seeding, test body, cleanup verification or lease release. Keep strict errors and redact credentials by preserving the existing telemetry contract. Only test-harness code and focused regressions change.

Before attempting three performance acceptance runs, use one diagnostic workflow to determine actual full-workflow duration and dedicated lifecycle costs. A future pre-migrated template/fork design is outside this slice and requires separate isolation/capacity evidence.

## Regression scenarios

1. Successful dedicated lifecycle emits exactly one create, prepare and delete phase record.
2. A failed preparation or body preserves the original failure and still attempts strict teardown and lease release; telemetry must not mask cleanup failures.
3. A failed create does not attempt deletion of an unknown branch or leak a lease.
4. Existing topology, transactional rollback, dedicated isolation, secret-safe telemetry and two-branch capacity invariants remain true.

## Security and correctness boundaries

No schema, migration, authentication, authorization, production behaviour or deployment changes. Tests use mocked lifecycle dependencies for focused regressions; real runs use test-owned ephemeral branches and existing strict cleanup. No secret values or connection strings enter telemetry. No timeouts, assertions, gates or required checks are weakened.

## Acceptance

The user confirmed a maximum of 15 minutes for the entire DB workflow, from workflow start through its required verdict, including setup, prerequisites, tests, cleanup and inter-job waits. Require three consecutive runs on the same final SHA, nine required files and 57 tests with zero skips plus any new base coverage, current-run branch deletion proof, stable rate limits and at most two active ephemeral branches. Faster than eight minutes is acceptable. Existing Kernel acceptance is authoritative.

## Reverse path

Revert the focused optimization and instrumentation commits to restore prior behaviour. Preserve the recorded recovery tip and keep the merged PR #187 lease hardening. Live test resources remain owned by the current test run and are deleted through existing cleanup.
