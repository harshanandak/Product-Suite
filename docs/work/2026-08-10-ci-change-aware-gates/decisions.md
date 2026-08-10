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
