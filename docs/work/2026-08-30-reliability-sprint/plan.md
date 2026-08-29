# Reliability Sprint Plan

Status: locked for the 2026-08-30 reliability sprint.

## Delivery contract

- Ship the four PRs in order: **R3 → R2 → R1 → R4**.
- Keep exactly one reliability PR open at a time.
- Before every push, prove that the branch contains the exact current `origin/main`
  ancestry; refresh the ref and stop for a rebase if it changed.
- Forge conditional merge predicates remain `checks_green`, `threads_resolved`,
  and `settle_min10`.
- This sprint does not change the Forge repository, Neon, gates, or branch
  protection configuration.

## Locked PR contracts

### R1 — branch-lease matrix

Cover the branch-lease matrix end to end: valid, missing, expired, and foreign
leases; branch/base/head identity; exact-main ancestry; and the single-open-PR
constraint. Acceptance requires deterministic tests for every matrix row and a
fail-closed result for stale or ambiguous lease evidence.

### R2 — seven HTTPS factories

Cover all seven transport factories with the HTTPS-only boundary. Acceptance
requires each factory to reject insecure or malformed endpoints, preserve the
existing dependency injection seams, and prove the canonical HTTPS path in
targeted tests without changing unrelated transport behavior.

### R3 — DB CI authority classification

Delivery classifier coverage is separate and does **not** set
`buildCiPlan().dbEvidenceRequired`. Add RED cases proving both exact paths
`apps/meeting-web/src/lib/runtimeConfig.js` and
`apps/platform-web/src/shell/ShellLayout.tsx` require DB evidence, including
canonical and mixed-case paths plus anchored near-miss negatives. Add only two
exact anchored case-insensitive `CI_DB_REQUIRED` patterns. Do not touch
workflows or the delivery classifier.

### R4 — budget scheduler

Keep the scheduler within its configured budget under concurrent work: no
unbounded fan-out, deterministic admission, and release of capacity on success,
failure, or cancellation. Acceptance requires bounded-concurrency tests and
proof that a failed task cannot strand budget or silently exceed the limit.

## Final critic gate

Muse **9.30 PASS**; GLM **9.33 PASS**; DeepSeek V4 Flash **9.48 PASS**;
DeepSeek V4 Pro **9.50 PASS**.
