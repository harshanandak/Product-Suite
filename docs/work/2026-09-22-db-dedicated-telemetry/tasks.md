# Dedicated DB lifecycle telemetry - tasks

## Task 1: measure the dedicated lifecycle with focused regressions

File(s): `apps/platform-api/test/db-contract/harness.ts`, `apps/platform-api/test/db-contract/suite-resource.test.ts`

OWNS: `apps/platform-api/test/db-contract/harness.ts`, `apps/platform-api/test/db-contract/suite-resource.test.ts`

What to implement: Add the smallest injectable dependency seam to `withDedicatedDbBranch`, with current production functions as defaults. Reuse `measurePhase` and the normalized runtime telemetry path to time exactly branch create, database prepare, and strict branch delete. Keep seed/body execution, cleanup error conversion, deletion proof, and lease release behavior unchanged. Extend the existing lifecycle tests; do not add a new test file.

TDD steps:

1. Write test: in `suite-resource.test.ts`, use mocked lifecycle dependencies and a temporary initialized telemetry ledger. Assert a successful lifecycle records one `create`, one `prepare`, and one `delete`, and releases its dedicated lease once. Add parameterized preparation/body failure coverage that preserves the original error, still deletes, and releases only after proven deletion. Assert raw telemetry excludes the mocked connection URI, branch id, credentials, and error details.
2. Run test: from `apps/platform-api`, run `bun x --no-install vitest run test/db-contract/suite-resource.test.ts`; confirm the new assertions fail because dedicated operations are not measured/test-injectable.
3. Implement: in `harness.ts`, default the seam to the existing lease/create/client/prepare/seed/delete functions. Wrap `createEphemeralBranch`, `prepareHarnessDatabase`, and the delete callback passed to `finishDedicatedBranchLifecycle` with existing `measurePhase`. Do not add phases, dependencies, timeouts, or error handling.
4. Run test: rerun the focused suite and confirm success. Then run `bun x --no-install vitest run test/db-contract/suite-resource.test.ts test/db-contract/telemetry.test.ts` and confirm all focused lifecycle, cleanup, lease, ledger, and secret-safety checks pass without live DB access.
5. Review: inspect the diff against the plan. Confirm no change to `vitest.db-contract.config.ts`, the 9-file/57-test required inventory, parent planning artifacts, workflow, schema, migrations, production code, branch cap, assertions, timeouts, or gates.
6. Commit: `test(db-contract): measure dedicated branch lifecycle`

Expected output: focused unit tests pass; each successful mocked dedicated lifecycle contributes exactly one create/prepare/delete record; failure paths preserve their primary error and strict cleanup/lease behavior; telemetry contains no secret-bearing values. Return the exact commit and focused evidence to the lead for independent spec review, quality review, normal validation, and one diagnostic workflow before any three-run acceptance sequence.

