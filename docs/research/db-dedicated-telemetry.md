# Dedicated DB lifecycle telemetry research

## Scope

This research supports child issue `59c1ab1c-d0aa-41f6-b964-63c68da6d11d`, parented to DB speed issue `5210cc14-ad2c-444a-9ea1-a28a1a68cb64`. It covers test-harness telemetry only. The parent seven-to-five optimization remains a separate approved commit and the parent issue retains final performance acceptance.

The child branch currently starts at PR #192 merge `783769b8db4c1bf524e12e216b4e2ce97ddd35ef`. Before Forge captures this plan, the lead will carry the preserved parent optimization onto that base and record its refreshed exact SHA in the child plan.

## Existing implementation to reuse

- `telemetry.ts` already provides `measurePhase`, a lock-protected allowlisted ledger, and the `create`, `prepare`, and `delete` phase names. No telemetry format or dependency is needed.
- `suite-resource.ts` already measures transactional branch create, prepare, and delete operations with an injectable dependency object.
- `harness.ts` performs the same lifecycle for every dedicated branch without phase measurement: acquire lease, create branch, prepare roles and migrations, seed, run the test body, strictly delete, then release the lease.
- `suite-resource.test.ts` already owns focused unit coverage for dedicated create failure, strict deletion, primary-error preservation, aggregate cleanup failure, and lease release. Extend this file rather than create another lifecycle test suite.

## Selected implementation seam

Add the smallest dependency seam to `withDedicatedDbBranch` needed to run its lifecycle without Neon. Production defaults remain the current concrete functions. Reuse `measurePhase` with the normalized runtime telemetry path and wrap exactly:

1. `createEphemeralBranch` as `create`.
2. `prepareHarnessDatabase` as `prepare`.
3. `deleteEphemeralBranchStrict` as `delete`, passed through the existing strict cleanup helper.

Do not measure lease waiting, seed, the test body, or lease release in this child. Do not change operation order or error conversion.

## Focused proof

Use mocked lifecycle dependencies and a temporary initialized telemetry ledger; do not provide real Neon credentials or make live database calls.

- Success records one create, one prepare, and one delete phase and releases the dedicated lease once.
- Preparation or body failure preserves the original failure, still records strict deletion, and releases the lease after deletion succeeds.
- A cleanup failure retains the existing aggregate/redacted error behavior and never releases a lease when deletion is unproven; existing focused assertions remain authoritative.
- Raw telemetry contains no connection URI, branch id, credential, or thrown error detail.

These unit regressions are outside `vitest.db-contract.config.ts`, so the required real-DB inventory remains 9 files and 57 tests with zero skips. Runtime savings remain unproven until one exact-head diagnostic workflow completes.

## Boundaries

No schema, migration, product, authentication, authorization, production runtime, branch cap, timeout, workflow, assertion, or security-gate change. No pre-migrated template/fork work. No new library, framework, telemetry field, or test file.

