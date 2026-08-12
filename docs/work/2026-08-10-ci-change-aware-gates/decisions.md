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
- A pull-request-only base-freshness workflow: it produces point-in-time evidence but cannot retrigger when the base advances, so it cannot be the merge-time authority.
- A status-writing fanout bot: live branch protection already provides authoritative strict-up-to-date enforcement without another privileged workflow.

## Deferred

- Consolidating/removing existing independent CI workflows after measured production evidence (Forge `a2e6e381-05d8-46d0-baf3-25042fd0168f`).
- Cache and runner-size tuning (Forge `4ed034f3-a9b7-4c99-a272-28e0ec86c8aa`).
- Unrelated flaky-test remediation (Forge `28ae0e84-7817-4ceb-b959-4f231b801d00`).

## Base freshness authority

- Live GitHub protection for `main` has strict required-check freshness enabled
  (`strict: true`), so GitHub's server-side merge evaluation is authoritative
  when the base branch advances.
- Remove the pull-request-only `Base Freshness` workflow and its helper/tests.
  They could prove ancestry only when triggered and therefore could leave stale
  green evidence after a later base update.
- No local helper remains because it was not wired into ship or pre-push. Any
  existing local ship/pre-push freshness check is supplementary feedback, never
  a substitute for strict server-side merge enforcement.

## Task 3: Validation evidence

- Review-correction RED: `bun test test/prepush-gate.test.js` produced 17 passed
  and 1 failed because the executable migration manifest incorrectly routed to
  non-authority `N/A`.
- GREEN focused classifier/adapter/repo-tooling run: 76 passed, 0 failed. Broad
  `bun run test:repo-tooling`: 166 passed, 0 failed.
- DB Contract YAML parsed successfully; targeted ESLint and Node syntax checks,
  source-test coupling, and `git diff --check origin/main` all passed.
- CodeRabbit CLI is unavailable on this machine. One structured static review
  of the final correction diff found no remaining actionable P0/P1 finding.
- The diff is limited to CI workflows, CI classifier/adapter scripts, their
  deterministic tests, the changelog, the plan decisions, and the root test
  script. No product source, migration, secret, environment, or branch-rule
  files changed. No hook bypass was used.
