# Reliability Sprint Tasks

The locked execution order is R3 → R2 → R1 → R4, with one open PR and an
exact-current-`origin/main` ancestry check before every push.

## R1 — branch-lease matrix

- Add deterministic coverage for valid, missing, expired, and foreign leases.
- Cover branch, base, and head identity plus exact-main ancestry.
- Enforce the single-open-PR constraint and fail closed on stale or ambiguous
  lease evidence.
- Acceptance: every matrix row has a passing test, and stale/foreign/missing
  evidence cannot authorize delivery.

## R2 — seven HTTPS factories

- Exercise all seven transport factories through the shared HTTPS boundary.
- Reject insecure and malformed endpoints while preserving injected seams.
- Acceptance: seven targeted factory cases pass for canonical HTTPS inputs and
  reject non-HTTPS or malformed inputs without unrelated transport changes.

## R3 — DB CI authority classification

1. **RED:** in `test/prepush-gate.test.js`, add cases proving
   `apps/meeting-web/src/lib/runtimeConfig.js` and
   `apps/platform-web/src/shell/ShellLayout.tsx` require DB evidence. Include
   canonical and mixed-case paths and anchored near-miss negatives; run the
   focused test and capture the expected failure.
2. **GREEN:** add only these two exact anchored, case-insensitive patterns to
   `CI_DB_REQUIRED` in `scripts/prepush-classify.mjs`:
   `^apps/meeting-web/src/lib/runtimeConfig\\.js$` and
   `^apps/platform-web/src/shell/ShellLayout\\.tsx$`. Do not modify workflows,
   delivery classifier code, or `buildCiPlan()` semantics.
3. **REFACTOR:** keep the smallest diff, run
   `bun test test/prepush-gate.test.js`, focused lint if applicable, and the
   relevant repo-tooling tests.

Acceptance: both exact paths require `buildCiPlan().dbEvidenceRequired`; mixed
case is accepted; anchored near misses remain non-authority; delivery
classifier coverage remains separate; and the requested tests pass.

## R4 — budget scheduler

- Bound concurrent work by the configured budget with deterministic admission.
- Release capacity on success, failure, and cancellation.
- Acceptance: tests prove no fan-out exceeds the budget and no failed task
  strands capacity or silently bypasses the limit.

## Cross-PR acceptance

- Merge predicates remain `checks_green`, `threads_resolved`, and `settle_min10`.
- No Forge repository, Neon, gate, or branch-protection changes are included.
- Final critic scores: Muse 9.30 PASS; GLM 9.33 PASS; DeepSeek V4 Flash 9.48
  PASS; DeepSeek V4 Pro 9.50 PASS.
