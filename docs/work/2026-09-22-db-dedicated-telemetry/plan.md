# Dedicated DB lifecycle telemetry

## Feature

- Slug: `db-dedicated-telemetry`
- Date: 2026-09-22
- Status: planning; Forge capture pending
- Refreshed parent optimization SHA: `ab49d7f34b74f9111d103e5be3731030680cd931`
- Parent issue: `5210cc14-ad2c-444a-9ea1-a28a1a68cb64`
- Child issue: `59c1ab1c-d0aa-41f6-b964-63c68da6d11d`

## Purpose

Measure the create, prepare, and delete cost currently omitted for dedicated DB Contract branches. The evidence will decide whether the stacked seven-to-five optimization is ready for performance acceptance or needs another separately approved optimization.

## Success criteria

- A successful dedicated lifecycle records exactly one `create`, one `prepare`, and one `delete` phase through the existing telemetry ledger.
- Preparation and test-body failures preserve the original error while strict deletion and lease release retain their current fail-closed behavior.
- Telemetry never contains credentials, connection strings, branch ids, or raw error details.
- Focused unit proof makes no live Neon or database calls.
- The real-DB inventory remains 9 files and 57 tests with zero skips; the new unit regressions stay outside required DB discovery.
- The lead runs one exact-head diagnostic whole workflow before three acceptance runs. Parent completion still requires three consecutive workflows on one SHA, each at most 15 minutes including prerequisites, setup, tests, cleanup, waits, and the final verdict, with current-run absence, at most two active branches, and stable rate limits.

## Out of scope

Schema, migrations, product/auth behavior, production code, workflow structure, timeouts, assertions, branch capacity, security gates, a pre-migrated template/fork, and new dependencies or telemetry formats.

## Approach selected

Extend `withDedicatedDbBranch` in `apps/platform-api/test/db-contract/harness.ts` with the smallest test dependency seam, following the existing `suite-resource.ts` pattern. Production defaults remain the current create, prepare, seed, delete, and lease functions. Use existing `measurePhase` with the normalized runtime telemetry path around only create, prepare, and strict delete.

Add the focused regressions to `apps/platform-api/test/db-contract/suite-resource.test.ts`, which already tests dedicated cleanup and lease semantics. Do not add a new test file or abstraction layer.

## Constraints

- The refreshed parent optimization commit must be the child's exact base before Forge capture; replace the pending SHA above only after the lead creates and verifies it on PR #192 merge `783769b8db4c1bf524e12e216b4e2ce97ddd35ef`.
- Preserve the parent plan and task snapshots byte-for-byte; this child owns only its separate research/plan/tasks and the two implementation files named below.
- Keep create -> prepare -> seed -> body -> strict delete -> lease release ordering.
- Keep absence-proven create handling, primary-error identity, aggregate cleanup errors, redaction, final cleanup proof, and the two-branch cap unchanged.
- No local proof may access live Neon or a live database.

## Edge cases

- Create failure records the attempted create through `measurePhase`; absence-proven handling remains responsible for lease release and does not attempt deletion of an unknown branch.
- Prepare or body failure still deletes the known branch and releases its lease after deletion is proven.
- Delete failure remains fail-closed, retains the lease, and preserves the existing redacted cleanup error or aggregate error.
- Telemetry recording uses only phase name, count, and duration; operation inputs and error values never enter the ledger.

## Technical research

Repository source already supplies the required mechanism and tests. `telemetry.ts` implements `measurePhase`; `suite-resource.ts` demonstrates phase wrapping and injectable unit dependencies; `suite-resource.test.ts` contains the dedicated lifecycle failure assertions to extend. Detailed evidence is in `docs/research/db-dedicated-telemetry.md`.

Focused commands, from `apps/platform-api`:

```text
bun x --no-install vitest run test/db-contract/suite-resource.test.ts
bun x --no-install vitest run test/db-contract/suite-resource.test.ts test/db-contract/telemetry.test.ts
```

## Ambiguity policy

Use the `/dev` seven-dimension decision rubric. Proceed and record a conservative choice only at 80% or higher confidence. Below 80%, stop and return the gap to the lead without expanding scope.

## Reverse path

Revert the child implementation commit. The parent seven-to-five optimization and its approved authority snapshot remain intact.
