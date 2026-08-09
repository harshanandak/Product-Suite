# DB Contract runtime reduction

**Issue:** `9a808ed4-16c1-48c7-8ffb-2e8a2c8aaaaf`

**Date:** 2026-08-09

**Status:** PLAN complete; DEV requires explicit approval

**Change class:** Standard test-infrastructure enhancement, split into two medium stacked PRs

**Planning base:** exact `origin/main` at `bd59a111d73c5b48bb1821b261111c349dc4e6fd`

**Dependency satisfied:** PR #165 merged as `9c38161b21fb88eaee6ffe50f55e9f43259ef86d`; its successor on the planning base is #166. Before DEV, rebase PR A onto the then-current `origin/main` and prove it contains both `9c38161b21fb88eaee6ffe50f55e9f43259ef86d` and this plan's base. No change is made to either merged PR by this plan.

## Purpose and measured baseline

The required DB Contract lane currently provisions, migrates, seeds, and deletes a branch for each of its 28 real-branch product assertions. The exact #165 merge-head evidence, [run 31314225243](https://github.com/harshanandak/Product-Suite/actions/runs/31314225243) at `9c38161b21fb88eaee6ffe50f55e9f43259ef86d`, completed **9 files / 57 tests** in **2573.78s** (tests: 2569.24s). The remaining 29 tests are control-plane/unit guards in the same required config. Branch provisioning and full migration replay, not Vitest collection, dominate the wall clock.

Reduce exact-head wall time to **8–15 minutes** without weakening the lane's evidence. The optimization is topology-only: run ordinary tests on suite-scoped migrated branches with transaction rollback, and keep behavior that depends on independent sessions, durable commits, roles, cleanup, or migration history on dedicated branches.

## Success criteria

1. Three consecutive reruns of the same exact head SHA finish the required real-Neon step in 8–15 minutes each.
2. Every selected DB Contract test executes: the current locked inventory is 9 files / 57 tests (28 real-branch assertions and 29 control-plane/unit assertions), with zero skipped, todo, pending, filtered, or silently uncollected tests; a zero-test or count-mismatch run fails.
3. Missing `NEON_API_KEY` or `NEON_PROJECT_ID` fails the required lane before any test is reported green. The normal unit lane excludes real-Neon files instead of skipping them.
4. Ordinary tests start from the canonical migrated suite branch, receive a fresh seed inside an outer transaction, and roll back all writes. A post-rollback sentinel proves no row/state leakage.
5. Application-level transaction calls use nested savepoints on the same pinned session. A failed nested operation rolls back to its savepoint without aborting the test harness transaction.
6. Concurrency/exactly-once, committed idempotency/redrive, live least-privilege probes, cleanup, and migration/bootstrap/history tests keep dedicated branches and real independent connections where the behavior requires them. Mocked authority, role-contract, and reaper guards are explicitly unit-only rather than mislabeled as branch proofs.
7. Every created branch has an exact run-owned name, `expires_at`, final delete, and control-plane 404 deletion proof. Final teardown proves that no run-owned branch remains. Cleanup failure makes the run `INCOMPLETE`/failed without hiding the original assertion failure.
8. Control-plane work is bounded to 2 concurrent suite resources initially and never above 3; 423/429/503 handling respects bounded backoff and safe-method retry rules.
9. Phase telemetry reports credential gate, stale reap, create/wait, migrate, seed, test, rollback, delete, deletion proof, counts, and total duration using stable codes and durations only—never credentials, connection URIs, query payloads, or raw control-plane bodies.
10. CI runs the repository-installed, lockfile-frozen Vitest binary through a package script. It never uses `bunx` or an auto-downloaded binary.
11. Exact-head evidence records and checks `git rev-parse HEAD == GITHUB_SHA`, and the summary includes the SHA, topology version, suite/test counts, zero-skip result, cleanup result, concurrency ceiling, and phase timings.

## Out of scope

- No product schema, migration, domain behavior, authorization rule, or production database mutation.
- No weakening of assertions, timeouts, credentials, branch ownership predicates, deletion proof, or required-check behavior.
- No shared long-lived database, schema-per-test substitute, snapshot restore, mocking of real-Neon assertions, or test sharding across unrelated projects.
- No edits, push, review resolution, merge, or cleanup of PR #165.
- No automatic concurrency above 3 and no retry of an indeterminate POST without reconciliation.

## Selected architecture

### Resource classes

| Class | Lifecycle | Reset | Intended tests |
|---|---|---|---|
| `transactional-suite` | One TTL branch per test file/suite; migrate once; one pinned session per ordinary test | `BEGIN`; canonical seed; nested application transactions use `SAVEPOINT`; `ROLLBACK`; sentinel query | Ordinary create/read/update, tenant-scoping queries, curator, ingest, memory-tier constraints and retrieval |
| `dedicated-branch` | One TTL branch for one behavior proof; migrate/seed as required; delete and prove 404 | Whole branch deletion | True concurrency/double-accept, committed idempotency/redrive/crash recovery, live permission probes, cleanup/deletion proof, fresh migration/bootstrap/history variants |
| `control-plane-unit` | No real branch | Mocks only | `neon-authority` authority/cleanup/retry guards, `role-privileges` contract guards, reaper predicate/pagination, telemetry redaction |

`withDbBranch` is not silently redefined. PR A makes topology explicit:

- `withTransactionalDb(...)` supplies only a transaction-bound `sql`, `seed`, and diagnostics safe for ordinary tests.
- `withDedicatedDbBranch(...)` preserves the existing real HTTP clients and independent-session behavior.
- Tests with mixed needs choose the helper per test; the topology manifest is reviewable and unit-tested.

The transaction adapter is test-only. It pins a `PoolClient` from `@neondatabase/serverless`, implements the minimal Neon `Sql` surface used by the contract tests (tagged-template query, `.query`, and `.transaction`), and represents a query as a lazy thenable descriptor. Direct awaits execute on the pinned client; `.transaction([...])` executes descriptors within a uniquely named savepoint, releasing on success and rolling back/releasing on error. Parameter values always remain parameters; the adapter never concatenates interpolated values into SQL. Any unsupported Neon query option fails closed with a stable code.

This use of WebSocket/session mode is deliberate: Neon's official driver documentation says HTTP transactions are non-interactive, while `Pool`/`Client` provide session and interactive transaction support. Dedicated tests continue using the production `neon-http` path where exact driver concurrency behavior is material.

### Suite lifecycle and cleanup proof

Vitest `globalSetup` performs required-credential validation, stale run-owned reap, branch-cap preflight, and initializes telemetry. It returns a global teardown that enumerates the current run's exact name prefix and fails if any run-owned resources remain. It does not pass connection strings through `project.provide`.

Each real suite registers `beforeAll`/`afterAll` through the suite resource helper. `beforeAll` creates a TTL branch and applies PR #165's canonical role + migration preparation once. `beforeEach` obtains one pinned client, begins the outer transaction, creates a root savepoint, and seeds canonical rows. `afterEach` rolls back, verifies the sentinel from a separate observer connection, then releases the client. `afterAll` deletes the branch and polls until 404.

Cleanup uses an error accumulator. The first test error remains primary; cleanup failures append stable error codes and still fail the run. Branch ids and URIs are not emitted. TTL is a crash safety net, not deletion evidence.

### Test classification lock

PR A records an explicit manifest and fails if any of the 57 included assertions is unclassified or falls outside its resource class.

- **Transactional suite (19 real assertions):** accept-path 2, 3, 4, and 9; baseline 1, 11, and 12; meeting ingest reads/mints/accepts/no-candidates; all three memory-curator cases; and all five memory-tier cases. These use one pinned session per test and must prove rollback sentinel absence.
- **Dedicated branch (9 real assertions):** accept-path 5 (re-accept), 6 (crash/redrive), 7 (snapshotted-team redrive), 8 (double accept), and both flip-loser races; baseline 10 (fresh full migration chain); the collaboration idempotency/ordering/ACL proof; and meeting-ingest rematerialization. They require durable state, migration history, or concurrent/independent production-shaped behavior.
- **Unit-only (29 assertions, no branch):** `neon-authority.test.ts` (18 mocked authority, cleanup, deletion-proof, and retry guards), `role-privileges.test.ts` (7 role-contract/probe-description guards), and `reap.test.ts` (4 exact-name/pagination/safety guards). They remain count-locked in the required DB Contract inventory; they are neither transactional nor dedicated branch evidence.

Classification is conservative: uncertainty routes to a dedicated branch. Moving a test from dedicated to transactional requires a test proving it does not depend on a second session, committed state across calls, role changes, DDL/history, or cleanup behavior.

### Concurrency rollout

PR A remains serial at the suite-resource layer to isolate the topology change. PR B introduces a semaphore with a hard maximum of 3 and starts at 2. It may move to 3 only in the same PR after three exact-SHA runs at 2 are green, cleanup-complete, rate-limit clean, and still above the desired timing margin. If any 423/429/branch-cap signal appears, ship at 2.

No test within a transactional suite becomes `test.concurrent`; Vitest file/suite parallelism is the only added concurrency. Vitest documents file parallelism and `maxWorkers` separately from within-file `.concurrent`, so the configuration keeps those boundaries explicit.

### Fail-closed runner and exact-head evidence

- The real config includes only the explicit real-DB manifest; the normal config excludes those files.
- Required setup throws if credentials are missing.
- A custom reporter fails on skipped/todo/pending tests, zero collected tests, count mismatch, cleanup incomplete, or absent exact-head metadata.
- The workflow runs `bun install --frozen-lockfile`, then `bun run --cwd apps/platform-api test:db-contract:required`; the script invokes local `vitest run`. `VITEST_SKIP_INSTALL_CHECKS=1` prevents dependency auto-install behavior.
- The workflow checks `git rev-parse HEAD` against `GITHUB_SHA` before running and uploads a redaction-safe JSON telemetry artifact plus `$GITHUB_STEP_SUMMARY` table.

## Alternatives rejected

1. **One branch per real assertion (current):** strongest simple isolation but repeats the dominant provisioning/migration work 28 times; the exact merged-head run took 2573.78s for all 57 locked tests.
2. **One branch for the whole run plus truncate/reset:** faster, but a leaked transaction or DDL can contaminate every later suite; it also prevents controlled 2–3 suite concurrency.
3. **Schema per test:** does not faithfully exercise `public`, search path, role grants, extension, and migration assumptions.
4. **HTTP transaction around arbitrary test bodies:** Neon HTTP supports non-interactive batches, not an interactive session around arbitrary async application calls. It cannot guarantee rollback of the existing call graph.
5. **Parallelize existing per-test branches:** multiplies branch/API pressure without removing repeated migration work and makes the current leak/rate-limit failure mode worse.

## Rate-limit and branch-cap contract

- Preflight lists all pages, reaps only exact run-owned expired/stale names, protects parent/default/protected/unmarked branches, and calculates available capacity before creating resources.
- The suite semaphore counts create/delete operations and active branches; default 2, hard maximum 3.
- GET and DELETE may retry 423/429/503 with bounded exponential backoff, jitter, `Retry-After` honoring, and a total deadline. POST is not blindly retried. After an indeterminate create, list/reconcile the deterministic run+suite name before deciding to fail or adopt exactly one branch.
- Duplicate matches, pagination uncertainty, cap uncertainty, or deletion not proven are failures—not permission to create/delete more.

Neon documents that branch create starts asynchronous `create_branch` and `start_compute` operations and recommends polling operation status. Neon also documents finite branch allowances and recommends expiration/automated cleanup for temporary branches. Those constraints are treated as correctness, not optional optimization.

## Security / OWASP pass

| Category | Applies | Planned mitigation |
|---|---|---|
| A01 Broken Access Control | Yes | Preserve tenant and least-privilege proofs on real dedicated resources; never use owner/BYPASSRLS credentials for permission assertions. |
| A02 Cryptographic Failures | Yes | Secrets remain step-scoped; never log URIs, tokens, response bodies, query values, or raw ids; telemetry uses stable codes/durations. |
| A03 Injection | Yes | Transaction adapter parameterizes every value and rejects unsupported interpolation/options; no SQL string concatenation. |
| A04 Insecure Design | Yes | Explicit topology manifest, conservative dedicated default, hard concurrency ceiling, zero-skip gate, and deletion proof. |
| A05 Security Misconfiguration | Yes | Fail closed on credentials/config, exact parent protection, normal-vs-required config separation, locked local binary. |
| A06 Vulnerable Components | Limited | Frozen lockfile and installed Vitest; no runtime package fetch through `bunx`. |
| A07 Identification/Auth Failures | Yes | Account API key remains control-plane-only; runtime permission proofs use intended roles. |
| A08 Integrity Failures | Yes | Exact-head check, frozen lockfile, explicit test-count manifest, immutable telemetry artifact. |
| A09 Logging/Monitoring Failures | Yes | Phase/error telemetry is complete but redaction-safe; cleanup and rate-limit failures are terminal. |
| A10 SSRF | Limited | Control-plane base stays fixed to Neon except existing explicit test seam; no user-derived URL. |

## Technical research

- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver): HTTP supports one-shot/non-interactive transactions; WebSocket `Pool`/`Client` supports sessions and interactive transactions. This is the basis for the pinned transaction adapter.
- [Neon system operations](https://neon.com/docs/manage/operations): branch creation can initiate asynchronous create/start-compute operations; poll terminal status before connecting.
- [Neon pricing and branch allowances](https://neon.com/pricing): temporary branches should use expiration and automated cleanup; concurrent branch counts are finite/costed.
- [Vitest parallelism](https://vitest.dev/guide/parallelism): file parallelism, workers, and within-file concurrent tests are separate controls. Only file/suite concurrency is enabled here.
- [Vitest global setup](https://main.vitest.dev/config/globalsetup): setup runs before workers and teardown after test files; it is appropriate for credential/reap/final cleanup audit.
- [Vitest setup files](https://main.vitest.dev/config/setupfiles): setup files execute per test file and in worker scope; resource lifecycle remains explicit in suite hooks to avoid hidden repeated work.
- [Vitest getting started](https://vitest.dev/guide/index.html): Vitest recommends a locally installed package/script; with Bun, use `bun run`, not Bun's own `bun test` runner.
- [PostgreSQL SAVEPOINT](https://www.postgresql.org/docs/current/sql-savepoint.html) and [ROLLBACK TO SAVEPOINT](https://www.postgresql.org/docs/current/sql-rollback-to.html): savepoints provide nested rollback within an open transaction.

## TDD scenarios

1. **Happy path:** two ordinary tests in one suite see the same branch id but different seed ids; test 2 cannot observe test 1's sentinel after rollback; migrations run once.
2. **Nested failure:** application `.transaction` fails after its first statement; adapter rolls back to/release savepoint, outer transaction remains usable, and final rollback leaves no state.
3. **True concurrency:** double-accept uses two independent production-shaped clients on a dedicated branch and still proves exactly one durable row.
4. **Cleanup failure:** assertion fails and delete/404 proof also fails; output preserves the assertion plus stable cleanup code, contains no URI/id, and the run is failed/INCOMPLETE.
5. **Credential/collection failure:** missing credentials, zero collected tests, or one skipped test fails before a green conclusion.
6. **Rate limit:** concurrent creates never exceed the configured semaphore; 429 honors bounded retry for safe calls, while an indeterminate POST reconciles by exact name instead of blind retry.
7. **Migration/permission edge:** migration history variants and least-privilege probes remain on dedicated resources and cannot be reclassified as transactional without an explicit manifest change.

## Two-PR stack and ownership

### PR A — suite resources, transactional rollback, and evidence (medium)

Base: the current `origin/main` descendant of PR #165 (`bd59a111d73c5b48bb1821b261111c349dc4e6fd` at planning refresh). Owns the harness/resource/adapter, test classification changes, fail-closed reporter, workflow invocation, and serial telemetry. Keeps `maxWorkers: 1`/suite concurrency 1. Exit requires a serial exact-head 9-file/57-test run with zero skips and cleanup proof; timing is measured, not guessed. The two-medium-PR stack remains sound: PR A changes isolation/topology serially, while PR B is limited to bounded parallelism after that proof.

### PR B — bounded suite concurrency (medium, stacked on PR A)

Owns only semaphore/tuning, config, workflow summary, and concurrency regression tests. Starts at 2; may use 3 only after three exact-SHA greens at 2 and no rate-limit/cap/cleanup signal. Exit requires three same-SHA 8–15 minute green runs.

No two parallel implementation tasks own the same file. Cross-PR overlap is intentional and sequential.

## Rollback

1. If PR B flakes, rate-limits, leaks, or exceeds caps, revert PR B only. PR A remains serial and safe.
2. If PR A leaks state or changes semantics, revert PR A. That restores the PR #165 merged per-test dedicated-branch topology.
3. Before either revert is declared healthy, run the required exact-head lane and prove all run-owned branches deleted. A revert is code rollback, not cleanup evidence.
4. No database rollback or production restore is required; all optimized resources are TTL test branches. Never delete by prefix alone during rollback.

## Ambiguity policy

Use the `/dev` seven-dimension decision rubric. At least 80% confidence may proceed with a logged decision; below 80% stops for review. Any ambiguity about isolation, transaction semantics, role behavior, branch ownership, cleanup, test collection, rate limits, or exact-head evidence is high impact and defaults to a dedicated branch or a stop—not a speed-biased assumption.
