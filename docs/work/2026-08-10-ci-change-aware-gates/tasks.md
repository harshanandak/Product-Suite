# Tasks: CI change-aware gate ordering

## Task 1: Produce a validated CI execution plan from the existing change graph

OWNS: `scripts/prepush-classify.mjs`, `scripts/ci-change-plan.mjs`, `test/prepush-gate.test.js`

File(s): `scripts/prepush-classify.mjs`, `scripts/ci-change-plan.mjs`, `test/prepush-gate.test.js`

What to implement: Extend the pure classifier without changing existing pre-push behavior. Return a deterministic, schema-versioned plan containing exact SHA, classification/reason, ordered cheap scripts, and `dbEvidenceRequired`. Add a CLI adapter that derives base/head inputs supplied by the workflow, validates refs/output, and fails closed to the full plan. Centralize authority/security/migration trigger ownership here rather than YAML regexes.

TDD steps:

1. Write table-driven tests for scoped workspace/dependent changes, docs-only, API/DB, migrations/infra, security/authority tooling, root manifest/lockfile/workflow, rename/delete, empty/invalid range, unknown path, deterministic ordering, and malformed input.
2. Run `bun test test/prepush-gate.test.js`; confirm the new plan API/CLI assertions fail because the plan does not exist.
3. Implement the minimal pure plan builder and CLI adapter; preserve all existing classifier exports/results.
4. Run the focused test and confirm all old and new cases pass deterministically.
5. Commit: `feat(ci): add change-aware gate plan`

Expected output: the same ordered JSON and GitHub outputs for identical inputs; ambiguous inputs always request full cheap validation and DB evidence.

## Task 2: Gate expensive DB proof behind exact-SHA changed-surface checks

OWNS: `.github/workflows/db-contract.yml`, `test/repo-tooling.test.js`

File(s): `.github/workflows/db-contract.yml`, `test/repo-tooling.test.js`

What to implement: After the pending DB Contract workflow has merged to `main`, refresh this independent branch from that exact `origin/main` and split the workflow into `classify`, `cheap-gates`, `db-contract-runtime`, and stable final `db-contract` jobs. Do not modify or stack onto active PRs. Bind all jobs to the classifier exact SHA. Run selected cheap scripts sequentially before the protected runtime job. Keep credentials only on runtime. Make the final sentinel explicitly validate job results, plan relevance, runtime verdict, and evidence SHA. Use PR-number-or-ref concurrency with `cancel-in-progress: true`.

TDD steps:

1. Add parsed workflow assertions (not loose substring-only checks) proving job dependencies, exact-SHA checkout/assertions, protected environment isolation, timeouts, pinned actions, install `--ignore-scripts`, concurrency grouping, stable sentinel name, and fail-closed result matrix.
2. Run `bun test test/repo-tooling.test.js`; confirm assertions fail against the single-job workflow.
3. Implement the four-job workflow with the smallest YAML change.
4. Run `bun test test/repo-tooling.test.js test/prepush-gate.test.js` and a YAML parse check; confirm pass.
5. Commit: `perf(ci): gate DB contract behind changed-surface checks`

Expected output: failing/cancelled cheap checks prevent the credentialed runtime from starting; the stable final check fails unless exact-head required evidence exists or non-authority `N/A` is proven.

## Task 3: Validate the integration boundary once

OWNS: `CHANGELOG.md`, `docs/work/2026-08-10-ci-change-aware-gates/decisions.md`

File(s): `CHANGELOG.md`, `docs/work/2026-08-10-ci-change-aware-gates/decisions.md`

What to implement: Document the behavior and run only the proportional local gates before one CI pass. Verify no product/migration files changed and no required status context was renamed. Record exact commands/results and defer unrelated P2 cleanup to Forge issues.

TDD steps:

1. Run focused classifier and repo-tooling tests, source-test coupling, YAML parse, lint/typecheck for changed scripts, and `git diff --check`.
2. Confirm the branch diff contains only planned CI/tooling/tests/docs paths.
3. Push once through the normal hook-preserving quick path; let CI run the broad suite once.
4. Verify exact PR head, required checks, review threads, and the DB job ordering in Actions evidence.
5. Commit: `docs(ci): document change-aware DB gating`

Expected output: one reviewable PR, exact-head green evidence, no bypasses, and no duplicate local full-suite run.
