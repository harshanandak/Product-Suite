# Ordered implementation tasks — delivery efficiency

This is a PLAN artifact for Forge epic
`b5e4ddb7-6fda-4d1a-a7c8-54cc83dca816`. It is not DEV authorization.

## Global execution rules

- Re-fetch and branch every slice from the verified current `origin/main`, not
  this plan commit. Record exact base/head and prove the live Forge lease.
- Treat every slice below as T3 until the trusted classifier and App-bound gate
  are themselves required and proven.
- One owner per file. No overlapping edits across slices.
- Use RED -> GREEN -> REFACTOR with command/output recorded on the Forge issue.
- Keep each PR independently reversible and roughly 300 authored changed lines
  when conceptually sound. Report generated lock/snapshot changes separately.
- Do not push/open/merge/apply branch protection/change credentials/run live Neon
  without the explicit gate for that stage.

## Slice 1 — Classifier contract and adversarial vectors

**Goal:** deterministic T0-T3 classification from exact base/head data, with
ambiguity and authority changes escalating to T3.
**Owns:**
`scripts/delivery/classify-change.mjs`,
`test/delivery/classify-change.test.js`.
**Does not own:** workflows, Forge config, branch protection, DB execution.

RED:

```powershell
bun test test/delivery/classify-change.test.js
```

Add table-driven failures for docs T0, UI T1, cross-app/API T2, auth/tenant/DB
T3, workflow/classifier self-change T3, unknown path T3, API/parser failure T3,
UI-only lock proof, DB-driver transitive lock change, and missing lock proof T3.
The new suite must fail because no classifier exists.

GREEN:

Implement the smallest pure classifier. It must not import/eval head code and
must emit versioned base/head/digest/reason/expected-check evidence. Run the same
command and existing repo-tooling tests:

```powershell
bun test test/delivery/classify-change.test.js
bun test test/repo-tooling.test.js
```

REFACTOR: remove duplicate path rules, keep an explicit T0 allowlist, and mutation
test every downgrade branch. Acceptance is 100% decision-vector coverage and no
unclassified success.

## Slice 2 — Always-emitted shadow aggregate

**Depends on:** Slice 1.
**Goal:** main-trusted controller opens one exact-head shadow gate and dispatches
selected validation without privileged head execution.
**Owns:**
`.github/workflows/delivery-controller.yml`,
`.github/workflows/delivery-validate.yml`,
`scripts/delivery/verify-gate-result.mjs`,
`test/delivery-gate.test.js`, and focused assertions in
`test/repo-tooling.test.js`.

RED:

```powershell
bun test test/delivery-gate.test.js test/repo-tooling.test.js
```

Prove failures for: top-level path filtering, privileged checkout of PR head,
unbound head/base, missing expected job, skipped expected job, zero tests,
artifact digest mismatch, stale workflow/controller SHA, self-spoofed gate, and
missing/mismatched machine-readable Forge issue or human-gate evidence.

GREEN: add report-only workflows. `pull_request_target` may read API data but
must never execute head code. The validation workflow is loaded from main,
checks out only the exact input SHA with read-only permissions, and has a fresh
`always()` aggregate verifier. Do not change branch protection.

Validation:

```powershell
bun test test/delivery-gate.test.js test/repo-tooling.test.js
```

Run shadow fixtures for one T0/T1/T2/T3 PR and confirm each exact head receives
one terminal result. Any security ambiguity blocks the slice.

## Slice 3 — Targeted jobs and DB trigger narrowing

**Depends on:** Slices 1-2, terminal-success proof for PR #165 exact-main DB
Contract run `31314225243`, and coordination with Forge issue
`9a808ed4-16c1-48c7-8ffb-2e8a2c8aaaaf`.
**Goal:** proportional jobs plus broad fast DB integrity and narrowly selected
full Neon.
**Owns:** `.github/workflows/delivery-validate.yml`,
`.github/workflows/db-contract.yml`, DB relevance rules in
`scripts/delivery/classify-change.mjs`, and related tests only.

RED:

```powershell
bun test test/delivery/classify-change.test.js test/delivery-gate.test.js test/repo-tooling.test.js
```

Add failures proving:

- unrelated UI/root dependency changes do not select full Neon;
- all lock changes select frozen install + fast migration integrity;
- platform-api, DB/migration/harness, DB-driver closure, and ambiguity select T3
  full Neon;
- T2 selects impacted integration/e2e; and
- zero/skipped/cleanup-incomplete DB runs fail.

GREEN: make DB Contract callable by trusted validation input, keep direct/main
coverage needed during transition, preserve restricted secret scope, and replace
broad manifest/lock triggers with proven relevance. Do not implement the separate
suite-branch speed plan here.

Validation includes existing migration parity, DB package unit/type checks, all
repo-tooling tests, and one approved ephemeral-Neon fixture per selected T3 case.
No live/shared/production branch may be targeted.

## Slice 4 — App-bound required gate with no protection gap

**Depends on:** at least ten successful shadow comparisons across all tiers.
**Goal:** make `delivery-gate` the stable App-bound branch-protection authority.
**Owns:** GitHub App manifest/operational configuration, branch protection/rules,
`.forge/config.yaml`, and minimal docs/tests. This is an explicit human/security
operation, not ordinary code-only DEV.

Precondition evidence:

- dedicated least-privilege App ID and protected secrets/environment;
- exact-head check identity cannot be produced by PR Actions;
- no N/A PR lacks a terminal aggregate;
- shadow verdict equals legacy checks for all samples; and
- rollback snapshot of current five required contexts.

Rollout order:

1. require `delivery-gate` **in addition to** the five existing contexts;
2. verify representative T0-T3 PRs and admin enforcement;
3. remove legacy required contexts one at a time only after proof; and
4. scope Forge `checks_green.only` to the App-bound aggregate while retaining
   `threads_resolved` and global 10-minute settle.

RED/GREEN evidence is an automated branch-protection conformance test plus live
API snapshots before/after. Any pending/spoof/missing result restores the five
contexts first.

## Slice 5 — Risk-aware PR template and deterministic worktree bootstrap

**Depends on:** Slice 1 classifier schema; may develop parallel to Slice 3 with
non-overlapping files.
**Goal:** eliminate stale-base setup and make review inputs complete at PR open.
**Owns:** `.github/PULL_REQUEST_TEMPLATE.md`,
`scripts/delivery/worktree-bootstrap.mjs`,
`test/delivery-worktree.test.js`, and focused `AGENTS.md`/toolchain guidance.

RED:

```powershell
bun test test/delivery-worktree.test.js test/repo-tooling.test.js
```

Fixtures must fail for stale fetched main, SHA drift during creation, dirty new
worktree, non-frozen install, unresolved executable, missing safe env input, port
collision, unpushed/dirty cleanup, and post-merge verification not complete.

GREEN: wrap existing `forge worktree create --base <exact-sha> --issue ...`
rather than reimplement issue authority. Record deterministic ports and bootstrap
evidence. Cleanup remains refusal-first and runs only after verified merge.

Template tests assert all risk, Neon, human-gate, exact-SHA, validation, rollback,
size/generated-lines, reviewer, correction-push and stacked-parent fields exist.
They must parse the machine-readable Forge issue/gate fields and reject a missing,
malformed, closed, foreign, or head-mismatched link before queue admission.

## Slice 6 — Queue dry-run, then guarded single-flight merge

**Depends on:** Slice 4 required gate and a callable trusted Forge broker/Kernel
lease proof.
**Goal:** rebase and validate one exact queued SHA automatically, initially with
no merge authority.
**Owns:** `.github/workflows/delivery-queue.yml`, queue verification code in
`scripts/delivery/verify-gate-result.mjs`, and `test/delivery-gate.test.js`.

RED fixtures:

- two simultaneous admissions;
- expired/foreign/missing issue lease;
- missing/mismatched PR issue link or human-gate evidence;
- stale base or force-with-lease mismatch;
- head changes after validation;
- unresolved thread/review/human gate regression;
- wrong App/check identity;
- stacked child still targeting feature branch; and
- post-merge verification/cleanup failure.

GREEN dry-run computes the exact rebase, dispatch, settle and merge decision but
cannot merge. Compare at least ten decisions with manual guarded snapshots.

Only a separate explicit human operation may enable guarded squash merge. The
active worker must re-prove lease and invoke the Forge exact-head merge contract;
all failures leave the PR open. Verify landing/tree/patch and exact-main health
before pruning/closing.

Add a break-glass test: a direct GitHub merge is never normal queue success and
requires an explicit logged human event plus a follow-up issue. The PR #165
missing-link failure is the regression fixture.

## Slice 7 — Tier-aware settle authority

**Depends on:** App-bound gate, queue dry-run parity, and either upstream Forge
tier evidence support or acceptance of the required App check as non-bypassable
settle authority.
**Goal:** adopt 0/2/5/10 minutes without a bypass.

RED tests mutate head, base, reviews, threads, classifier digest and check
conclusions during each timer; each must reset. Tests also prove a PR workflow
cannot forge the App-bound success.

GREEN keeps `delivery-gate` pending until the trusted timer expires. Only after
live proof may `.forge/config.yaml` stop adding an unconditional ten minutes.
Rollback restores global ten minutes before disabling tier settlement.

## Slice 8 — Metrics and routing policy

**May start after:** Slice 1 event schema; ship after aggregate authority.
**Goal:** measure the seven latency segments and reduce agent waiting without
capturing content.
**Owns:** `scripts/delivery/metrics.mjs`, metrics tests, and narrowly scoped
`AGENTS.md` plus canonical `skills/validate`/`skills/ship` updates and generated
mirrors.

RED tests reject secret/content fields, mutable event identity, missing SHA/tier,
negative/overlapping durations, and metrics that collapse CI/human/agent wait.

GREEN emits issue/PR/SHA/tier/controller-version timestamps and calculates P50/
P75, correction count, unnecessary Neon, stale worktree and change-failure rate.
Routing contract: T0/T1 one owner + at most one reviewer; T2 one specialist only
on named risk; T3 bounded non-overlapping specialists; event-driven CI wait.

Validate the computed PR #159/#164 baselines against the plan before enabling a
dashboard. Treat two PRs as calibration only.

## Final rollout gate

Before declaring the initiative complete, prove:

1. T0/T1 P50 <30m and P75 <60m over a meaningful sample;
2. T2 P75 <4h;
3. correction pushes <=1 for the target cohort;
4. no unnecessary full real-Neon runs and no missed DB-relevant runs;
5. every new worktree starts at verified current main;
6. no reduction in tenant/auth/security/migration/rollback/concurrency coverage;
7. queue exact-SHA and lease invariants under race tests; and
8. rollback rehearsal restores the five checks, ten-minute settle and broad DB
   trigger without a protection gap.

T3 live Neon or release operations remain separately human-approved even after
all delivery automation is proven.
