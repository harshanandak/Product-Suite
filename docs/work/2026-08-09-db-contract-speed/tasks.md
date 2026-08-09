# DB Contract runtime reduction — TDD task list

**Issue:** `9a808ed4-16c1-48c7-8ffb-2e8a2c8aaaaf`

**Dependency:** PR #165 merged at `9c38161b21fb88eaee6ffe50f55e9f43259ef86d`; this refreshed plan is based on `origin/main` `bd59a111d73c5b48bb1821b261111c349dc4e6fd`. DEV still requires an explicit human gate.

**Target:** two medium stacked PRs; exact-head required real-Neon lane 8–15 minutes, zero skips, complete cleanup proof.

## Execution rules

- Rebase PR A on the current `origin/main` immediately before RED and verify `git merge-base --is-ancestor 9c38161b21fb88eaee6ffe50f55e9f43259ef86d HEAD`; also record the exact current-main base SHA.
- Use the repository-installed Vitest through `bun run`; never `bunx`, `npx`, `bun test`, `--no-verify`, or skipped tests.
- Every task follows RED → GREEN → REFACTOR and commits only after its focused checks pass.
- Real-Neon commands require approved CI credentials. Never print or inspect secret values locally.
- A test not explicitly classified is a hard failure. The locked starting inventory is 9 files / 57 tests: 19 transactional real assertions, 9 dedicated-branch real assertions, and 29 control-plane/unit assertions. Unknown real work defaults to dedicated isolation; unit-only work cannot be claimed as real-branch evidence.

## PR A — serial suite-scoped isolation and evidence

### Task A1 — lock the topology inventory and fail-closed collection

**OWNS:**
- `apps/platform-api/test/db-contract/topology.ts` (new)
- `apps/platform-api/test/db-contract/topology.test.ts` (new)
- `apps/platform-api/test/db-contract/zero-skip-reporter.ts` (new)
- `apps/platform-api/test/db-contract/zero-skip-reporter.test.ts` (new)
- `apps/platform-api/vitest.db-contract.config.ts`

**What to implement:** Define stable suite ids and classify the locked 57-test inventory: 19 real assertions as `transactional-suite`, 9 real assertions as `dedicated-branch`, and 29 assertions as `control-plane-unit`. The latter are `neon-authority` (18), `role-privileges` (7), and `reap` (4): count-lock them, but never represent them as branch coverage. Add a reporter that fails on zero collected, any 57-count mismatch, skipped/todo/pending/filtered tests, missing exact-head metadata, or incomplete cleanup. Keep suite concurrency 1.

**TDD steps:**
1. RED: fixtures with one unclassified, one skipped, and zero tests must return stable failures `DB_CONTRACT_UNCLASSIFIED`, `DB_CONTRACT_SKIPPED`, and `DB_CONTRACT_ZERO_TESTS`.
2. Run: `bun run --cwd apps/platform-api test test/db-contract/topology.test.ts test/db-contract/zero-skip-reporter.test.ts`; confirm those assertions fail because modules do not exist.
3. GREEN: implement the explicit manifest/reporter; no regex-only prefix classification for destructive behavior.
4. Run the focused command again; then `bun run --cwd apps/platform-api typecheck`.
5. Commit: `test(db-contract): lock real-suite topology and collection`

**Expected output:** all 57 current assertions are classified exactly once; any skip/zero/count-mismatch/unclassified condition exits nonzero without revealing secrets.

### Task A2 — implement the pinned-session Neon SQL adapter

**OWNS:**
- `apps/platform-api/test/db-contract/transaction-sql.ts` (new)
- `apps/platform-api/test/db-contract/transaction-sql.test.ts` (new)

**What to implement:** Build a test-only lazy thenable query descriptor compatible with the tagged-template, `.query`, and `.transaction` surfaces used by DB Contract code. Bind execution to one `PoolClient`; preserve parameters; implement nested application transactions with unique savepoints; reject unsupported options with stable redacted codes.

**TDD steps:**
1. RED: mocked client tests prove interpolation becomes `$1...$n`, direct await executes once, `.transaction` emits `SAVEPOINT`/`RELEASE`, failure emits `ROLLBACK TO SAVEPOINT` then `RELEASE`, and raw values never occur in SQL/logged errors.
2. Run: `bun run --cwd apps/platform-api test test/db-contract/transaction-sql.test.ts`; confirm missing adapter/failing savepoint assertions.
3. GREEN: implement only the query shapes found in the topology inventory; fail closed for unsupported query options.
4. Run focused test and `bun run --cwd apps/platform-api typecheck`.
5. Commit: `test(db-contract): add transaction-bound sql adapter`

**Expected output:** ordinary application calls execute on one pinned session; nested failures do not poison the outer harness transaction; values remain parameterized.

### Task A3 — create suite resources and prove rollback/cleanup

**OWNS:**
- `apps/platform-api/test/db-contract/suite-resource.ts` (new)
- `apps/platform-api/test/db-contract/suite-resource.test.ts` (new)
- `apps/platform-api/test/db-contract/harness.ts`
- `apps/platform-api/test/db-contract/neon-branch.ts`
- `apps/platform-api/test/db-contract/reap-setup.ts`

**What to implement:** Add `withTransactionalDb` and `withDedicatedDbBranch`. A transactional suite creates/migrates one TTL branch in `beforeAll`; each test begins, seeds, executes, rolls back, then proves a sentinel is absent from an observer. Dedicated branches preserve PR #165's production-shaped path. Delete must poll 404; aggregate cleanup failure with the original error. Global setup fails closed on credentials, reaps safely, preflights capacity, and final teardown proves zero current-run branches.

**TDD steps:**
1. RED: mocked control-plane/session tests prove migrate-once, seed-per-test, rollback after pass/fail, observer sentinel absence, exact ownership predicate, parent/default/protected safety, TTL, 404 proof, and dual assertion+cleanup error retention/redaction.
2. Run: `bun run --cwd apps/platform-api test test/db-contract/suite-resource.test.ts test/db-contract/reap.test.ts`; confirm lifecycle assertions fail.
3. GREEN: implement resource lifecycle and cleanup ledger with stable codes; never swallow deletion failure in required mode.
4. Run focused tests, `bun run --cwd apps/platform-api typecheck`, and `bun run --cwd apps/platform-api lint`.
5. Commit: `test(db-contract): reuse migrated branches with rollback isolation`

**Expected output:** one migrated branch serves each ordinary suite serially; every test is rolled back and observed clean; all created branches are TTL-marked, deleted, and 404-proven.

### Task A4 — route ordinary and dedicated proofs explicitly

**OWNS:**
- `apps/platform-api/test/db-contract/accept-path.test.ts`
- `apps/platform-api/test/db-contract/baseline.test.ts`
- `apps/platform-api/test/db-contract/collaboration.test.ts`
- `apps/platform-api/test/db-contract/meeting-ingest.test.ts`
- `apps/platform-api/test/db-contract/memory-curator.test.ts`
- `apps/platform-api/test/db-contract/memory-tier.test.ts`

**What to implement:** Replace credential skips and implicit `withDbBranch` use in the six real-branch files with explicit topology helpers. Route exactly the 19 ordinary assertions to transactions; keep the 9 dedicated assertions (accept 5–8 and both flip-loser races, baseline migration-chain, collaboration, and meeting rematerialization) on dedicated resources. `neon-authority` (18), `role-privileges` (7), and `reap` (4) are unit-only count-locked guards and must not be migrated to either helper. Keep real permission probes, conformance, and cleanup on dedicated resources. Do not weaken assertions or reduce the 57-test count.

**TDD steps:**
1. RED: topology test must fail while any test is skipped, unclassified, or uses the wrong helper; add a regression proving two ordinary tests cannot see each other's unique sentinel.
2. Run: `bun run --cwd apps/platform-api test test/db-contract/topology.test.ts`; confirm classification/skip failures.
3. GREEN: mechanically route tests; preserve independent clients in concurrency cases and exact HTTP clients where driver behavior is asserted.
4. Run unit/static checks; then approved real lane: `bun run --cwd apps/platform-api test:db-contract:required -- --reporter=verbose`.
5. Commit: `test(db-contract): route real proofs by isolation need`

**Expected output:** all 9 files / 57 selected tests execute once, ordinary state is rolled back, and dedicated behavior remains genuinely isolated/committed/concurrent.

### Task A5 — add phase telemetry and a locked exact-head CI runner

**OWNS:**
- `apps/platform-api/test/db-contract/telemetry.ts` (new)
- `apps/platform-api/test/db-contract/telemetry.test.ts` (new)
- `apps/platform-api/package.json`
- `.github/workflows/db-contract.yml`
- `test/repo-tooling.test.js`

**What to implement:** Record redaction-safe phase durations/counts and cleanup/rate-limit result. Add local Vitest package scripts for list and required run. Workflow must check checkout SHA, use frozen install, set `VITEST_SKIP_INSTALL_CHECKS=1`, call `bun run --cwd apps/platform-api test:db-contract:required`, and publish JSON + step summary. Remove `bunx`. Keep credentials step-scoped and required mode fail closed.

**TDD steps:**
1. RED: telemetry tests reject URI/token/raw-id fields; tooling test rejects `bunx`, missing SHA check, missing frozen install, missing zero-skip/cleanup summary, or an unscoped secret.
2. Run: `bun run --cwd apps/platform-api test test/db-contract/telemetry.test.ts` and `bun test test/repo-tooling.test.js`; confirm failures on current workflow.
3. GREEN: implement scripts, telemetry, workflow, and tooling assertions.
4. Run focused tests plus `bun run test:repo-tooling`, platform-api lint/typecheck/unit tests, and workflow YAML validation available in the repo.
5. Commit: `ci(db-contract): emit exact-head phase evidence`

**Expected output:** CI uses the lockfile-installed Vitest, fails closed, and emits exact-head count/timing/cleanup evidence with no secret-bearing fields.

### PR A validation and handoff

Run:

```text
bun install --frozen-lockfile
bun run --cwd apps/platform-api lint
bun run --cwd apps/platform-api typecheck
bun run --cwd apps/platform-api test
bun run test:repo-tooling
```

Then push through normal Forge gates and run the required exact-head workflow. Acceptance for stacking PR B: one serial green 9-file/57-test run, zero skipped/unclassified/count-mismatch tests, complete 404 cleanup proof, no state-leak failure, telemetry artifact attached, and exact checked-out SHA. Record phase timings; do not claim the final 8–15 minute target yet if it is not met.

## PR B — bounded 2–3 suite concurrency

### Task B1 — add a rate-aware suite semaphore at concurrency 2

**OWNS:**
- `apps/platform-api/test/db-contract/suite-resource.ts`
- `apps/platform-api/test/db-contract/suite-resource.test.ts`
- `apps/platform-api/test/db-contract/neon-branch.ts`
- `apps/platform-api/test/db-contract/neon-branch-rate-limit.test.ts` (new)

**What to implement:** Add one process-wide limiter for active suite resources/control-plane operations. Default and CI value 2; hard reject values above 3. Honor bounded `Retry-After`/backoff for safe GET/DELETE. Reconcile indeterminate create by deterministic run+suite name; never blindly retry POST. Fail on duplicate/unknown reconciliation or insufficient capacity.

**TDD steps:**
1. RED: deferred-promise tests prove no more than 2 active resources; values 0/>3 fail; 429/423/503 safe calls back off within deadline; POST transport ambiguity lists/reconciles exactly once; duplicate match fails.
2. Run: `bun run --cwd apps/platform-api test test/db-contract/suite-resource.test.ts test/db-contract/neon-branch-rate-limit.test.ts`; confirm concurrency/reconciliation failures.
3. GREEN: implement limiter and bounded retry/reconciliation without weakening ownership predicates.
4. Run focused tests, lint, and typecheck.
5. Commit: `test(db-contract): bound suite concurrency and Neon operations`

**Expected output:** at most two suite branches/operations overlap; unsafe retry is impossible; all resources retain TTL and deletion proof.

### Task B2 — enable Vitest file parallelism and prove no cross-suite leakage

**OWNS:**
- `apps/platform-api/vitest.db-contract.config.ts`
- `apps/platform-api/test/db-contract/topology.test.ts`
- `apps/platform-api/test/db-contract/zero-skip-reporter.test.ts`

**What to implement:** Enable file parallelism with `maxWorkers: 2`; keep within-file tests sequential and `maxConcurrency: 1`. Make each worker/suite resource unique by exact run+suite identity. Add deterministic two-suite overlap tests and ensure cleanup/test-count aggregation remains complete across workers.

**TDD steps:**
1. RED: a two-suite fixture must overlap suite lifetimes while unique sentinels remain invisible across suites; reporter must merge both worker results and fail if either cleanup proof is absent.
2. Run focused topology/reporter/resource tests; confirm serial config fails the overlap expectation.
3. GREEN: set worker/file options and aggregate evidence without `test.concurrent`.
4. Run the full local unit/static validation from PR A.
5. Commit: `test(db-contract): run isolated suites two at a time`

**Expected output:** two suite branches run concurrently, tests inside each suite remain sequential, and evidence includes every suite exactly once.

### Task B3 — exact-SHA performance gate and optional ceiling 3

**OWNS:**
- `.github/workflows/db-contract.yml`
- `apps/platform-api/package.json`
- `apps/platform-api/test/db-contract/telemetry.ts`
- `apps/platform-api/test/db-contract/telemetry.test.ts`
- `test/repo-tooling.test.js`

**What to implement:** Set suite concurrency 2 in CI, expose no value above hard maximum 3, and make the summary report timing budget without hiding functional failure. Rerun the exact same SHA three times. Move to 3 only if all three at 2 are green/cleanup-complete/rate-limit clean and timing needs more margin; otherwise ship 2.

**TDD steps:**
1. RED: evidence-policy tests reject mixed SHAs, fewer than 3 runs, any skip/cleanup/rate-limit signal, or runtime outside 8–15 minutes; config test rejects >3.
2. Run telemetry/tooling tests; confirm missing performance evidence policy.
3. GREEN: implement evidence summary/gate. Do not encode a functional pass from timing alone.
4. Push normally and rerun the same exact head SHA three times with approved credentials. Capture run URLs and phase tables in the PR/Forge issue.
5. If eligible, change ceiling to 3 and repeat three same-SHA runs; otherwise retain 2. Commit: `ci(db-contract): enforce bounded runtime evidence`

**Expected output:** three consecutive exact-head required runs are green in 8–15 minutes, zero skips, zero state leakage, cleanup proven, and no rate-limit/cap signal.

### PR B rollback check

Before merge, prove reverting PR B's config returns suite concurrency to 1 while PR A's tests remain green. Operational rollback is `git revert <PR-B-merge-sha>` followed by an exact-head required run and final branch audit. If PR A itself is unsafe, revert PR A after PR B; PR #165's per-test topology is the known fallback.

## Final acceptance evidence

- PR #165 merge SHA (`9c38161b21fb88eaee6ffe50f55e9f43259ef86d`) and ancestry proof, plus the exact current-main rebase base.
- PR A and PR B exact head SHAs.
- Three same-SHA required workflow URLs with 8–15 minute suite duration.
- Collected/executed count equality at 9 files / 57 tests and zero skips/todos/pending.
- Per-phase redaction-safe telemetry.
- Current-run branch count returns to zero with delete + 404 proof.
- Rate-limit/cap counters show no unhandled signal.
- No product/migration/schema diff and no weakened assertion.
