# Decisions: CI change-aware gate ordering

## Locked

- Reuse `scripts/prepush-classify.mjs` as the single workspace/dependency routing authority.
- Implement as one bounded, independent PR from refreshed `origin/main` after the pending DB Contract workflow merges; never stack onto or edit active PRs.
- Preserve the externally required `DB Contract / db-contract` context via a final sentinel.
- Run selected suites sequentially to avoid oversubscription-related flakes.
- Cancel superseded PR/ref runs before expensive work.
- Keep Neon credentials exclusively in the protected runtime job.
- Treat unknown inputs and authority/security/migration surfaces as full-impact and DB-required.
- Permit `N/A` only for a validated non-authority plan after cheap checks pass; it is never DB evidence.
- Use focused local validation and one broad CI pass; do not repeatedly run unchanged full suites.

## Rejected

- Cross-workflow `workflow_run` orchestration: indirect exact-head binding and skipped-workflow semantics are too fragile.
- Duplicated path regexes in YAML: they drift from the tested workspace dependency graph.
- Renaming the required check: it would add branch-protection migration risk with no product value.
- Parallelizing selected suites on one runner: existing evidence shows worker oversubscription can create flakes.
- Treating skipped/cancelled jobs or a textual `N/A` as success when DB evidence is required.

## Deferred

- Consolidating/removing existing independent CI workflows after measured production evidence.
- Cache and runner-size tuning.
- Unrelated flaky-test remediation.

## Task 4: Base freshness gate

- Add a stable `Base Freshness / base-freshness` pull-request check in this same
  independent PR. It checks out the exact head SHA, fetches the current base
  branch, and uses `git merge-base --is-ancestor`; it never relies on a GitHub
  merge ref or credentials.
- Preserve existing required status contexts while this workflow lands. After
  the workflow is merged and observed green, update branch protection to add
  `Base Freshness / base-freshness` as a required check; that protection change
  is deliberately a post-merge operator action, not part of this code PR.
- The deterministic fixture rejects a base that advances after an earlier check,
  preventing stale green evidence without network or clock-dependent tests.

## Task 3: Validation evidence

- Focused changed-surface/classifier, adapter, base-freshness, and repo-tooling
  tests: `bun test test/prepush-gate.test.js test/prepush-classify.test.js
  test/ci-change-plan.test.js test/base-freshness.test.js
  test/repo-tooling.test.js` — 70 passed, 0 failed.
- Workflow and classifier YAML/diff checks passed; targeted ESLint for all new
  scripts/tests passed; `git diff --check` passed.
- `bun run test:repo-tooling` exercised 138 passing tests but exposed one
  pre-existing Windows CRLF assertion in
  `test/neon-production-preflight-workflow.test.js` (it expects an LF literal
  while the merged workflow is checked out as CRLF). This branch leaves the
  unrelated preflight test/workflow untouched; Ubuntu CI reads the canonical LF
  blob and remains the authoritative broad run.
- The diff is limited to CI workflows, CI classifier/adapter scripts, their
  deterministic tests, the changelog, the plan decisions, and the root test
  script. No product source, migration, secret, environment, or branch-rule
  files changed. No hook bypass was used.
