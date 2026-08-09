# Product-Suite fail-closed delivery efficiency

**Forge epic:** `b5e4ddb7-6fda-4d1a-a7c8-54cc83dca816`
**Classification:** T3 / Critical during rollout because this changes CI authority,
branch protection, merge control, and the classifier itself.
**Initial audit base:** `origin/main` at
`341caeb0072f6642ce9b2172c1d092f91bcd3265`, fetched and verified on
2026-08-09.
**Handoff base:** after PR #165 landed during planning, this docs branch was
restacked onto exact `origin/main`
`9c38161b21fb88eaee6ffe50f55e9f43259ef86d` before handoff.
**Stage:** PLAN only. No implementation, push, PR, merge, live-Neon mutation, or
material cleanup is authorized by this document.

## Outcome

Reduce idea-to-merge time by selecting validation and orchestration proportional
to verified change risk, while keeping one stable required gate and preserving
all current safety boundaries:

- Neon is the sole live PostgreSQL authority.
- Ambiguity escalates to T3; it never downgrades or silently skips.
- Tenant isolation, identity mapping, authentication, security, migration and
  rollback evidence, exact-SHA checks, issue leases, resolved review threads,
  and explicit human stage/operation approvals remain fail-closed.
- A human PLAN approval is not DEV, SHIP, merge, deployment, or live-database
  approval.

Targets after staged proof:

| Tier | Target |
| --- | --- |
| T0/T1 | P50 PR-open-to-merge < 30 minutes; P75 < 60 minutes |
| T2 | P75 PR-open-to-merge < 4 hours |
| All | At most one batched correction push; zero stale-base worktrees |
| DB relevance | Zero unnecessary full real-Neon runs; zero missed relevant runs |

## Read-only live audit

The following state was read live; no remembered SHA or Shepherd verdict was
treated as authority.

### Repository and worktrees

- At initial audit, `origin/main` was exactly `341caeb...3265` (`feat: pilot
  TanStack Query server state (#164)`). During planning PR #165 advanced main to
  exact `9c38161b...f86d`; the plan branch was fetched, checked clean and
  restacked to that SHA rather than handed off stale.
- Before this isolated plan worktree was created, 21 worktrees were attached.
  The primary checkout was detached at `a88f97b...`, dirty with 19 status rows,
  and eight commits behind `origin/main`.
- Multiple feature worktrees were already behind main; observed examples ranged
  from one to 24 commits behind. Four observed worktrees were dirty. Nothing was
  cleaned, rebased, moved, or overwritten.
- This plan worktree was then created by Forge from the verified 40-character
  main SHA; it started clean with `HEAD == origin/main`.

### Pull requests and enforcement

- At initial audit one PR was open: #165, exact head `905c327f...`, exact base
  `341caeb...`, 107 files and 16,409 changed lines. It subsequently squash-merged
  at `2026-08-09T12:48:55Z` as exact main `9c38161b...`; reviewed-head and squash
  trees were identical. A refreshed live query then showed zero open PRs.
- On exact main, Meeting/Platform/Roadmap/Repo/Deploy workflows were green while
  DB Contract run `31314225243` remained `IN_PROGRESS` at handoff. This is not a
  pass and blocks PR #165 post-merge cleanup/health closure, but it does not
  authorize this plan's DEV stage.
- Live `main` branch protection is strict/up-to-date, applies to admins, requires
  linear history and resolved conversations, disallows force pushes/deletion,
  and requires exactly these five GitHub Actions contexts:
  `test`, `typecheck-and-build`, `backend`, `repo-tooling`, `meeting-web`.
- Branch protection currently has no required pull-request-review count.
  Product/Forge human gates remain separate authority and must not be inferred
  from this omission.
- The public repository is personally owned (`owner.type=User`). Native GitHub
  merge queue is therefore not assumed available. GitHub documents native queue
  availability for qualifying organization repositories and requires CI to
  handle `merge_group`; see
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue>
  and
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group>.

### Current Forge and workflow behavior

- Installed Forge is `0.1.0-beta.5`, the current registry beta; `forge upgrade
  --dry-run` passed runtime/config/lock readiness. It also reported a deferred
  Beads-to-Kernel migration and Claude-hook self-heal; neither is part of this
  plan.
- `.forge/config.yaml` uses bare `checks_green`, `threads_resolved`, and a global
  `settle_min: 10`. Bare `checks_green` treats every reported green check as a
  merge input, even though GitHub protects only five contexts.
- beta.5 supports scoped `checks_green`, but has no verified tier-aware settle
  primitive. The 0/2/5/10 policy must not ship by merely setting global settle
  to zero. A required, controller-authenticated tier gate or an upstream Forge
  rule is required first.
- On the initial #164 base, `.github/workflows/db-contract.yml` used top-level
  path filters including `apps/platform-api/**`, `packages/db/**`,
  `package.json`, `bun.lock`, and its own workflow file. PR #165 partially fixed
  the required-check behavior: exact handoff main now reports DB Contract on
  every PR and emits explicit N/A for irrelevant changes.
- The inner #165 relevance regex still treats every root `package.json` or
  `bun.lock` change as full real-Neon relevance. The remaining optimization is
  therefore to replace that broad dependency rule with positive runtime-driver
  closure proof while preserving the always-emitted check and fast migration
  integrity. `test/repo-tooling.test.js` now protects the every-PR/N/A behavior
  but does not yet prove dependency-closure selection.
- `AGENTS.md` says a generated PR template exists, but live main contains no
  `.github/PULL_REQUEST_TEMPLATE.md` or equivalent template.
- A subsequent guarded merge attempt for PR #165 exposed the practical impact:
  `forge merge --auto --expect-head --issue` rejected the merge because the PR
  body did not authoritatively link its Kernel issue. The exact-head GitHub
  fallback then merged successfully. The normal path must therefore require a
  machine-readable, validated Forge issue and human-gate link before merge;
  direct/manual merge becomes logged break-glass only, not routine recovery.
- GitHub warns that a workflow skipped by top-level path filtering can leave a
  required check pending. The proposed stable aggregate therefore always starts
  and uses job conditions for no-op success:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#example-including-paths>.

## Measured baseline

GitHub timestamps are authoritative for PR/check events. “Earliest commit” is
only a start/idea proxy; neither PR contains a true idea timestamp.

| Measure | PR #159 | PR #164 |
| --- | ---: | ---: |
| Changed lines / files / commits / reviews | 68 / 2 / 2 / 4 | 1,295 / 24 / 11 / 6 |
| Earliest commit -> PR open | 41.0m | 477.6m |
| PR open -> last correction commit | 59.1m | 18.7m |
| Last correction -> merge | 175.3m | 37.9m |
| PR open -> merge | 234.4m | 56.5m |
| Earliest commit -> merge | 275.4m | 534.2m |

Additional evidence:

- PR #159's final required CI completed by `14:45:50Z`; merge occurred at
  `17:39:09Z`, leaving about 173 minutes after green. It did not need real Neon,
  yet unrelated application/deploy checks still ran.
- PR #164's correction checks started around `20:21:48Z`. DB Contract ran from
  `20:22:02Z` to `20:48:33Z` (26m31s) and dominated CI; merge followed at
  `20:56:38Z`.
- PR #164's 1,295 changed lines and 24 files show the review cost of a broad
  pre-PR slice; PR #159 shows that even a 68-line slice can spend hours waiting
  after correction.

Transcript evidence is directional, not attributed entirely to either PR:

- Codex session `019fdc03-7585-7e90-b706-9507a5808458` covered Product-Suite
  work including #159 over about 13h31m and recorded 29 `spawn_agent`, 154
  `wait_agent`, and 95 `send_message` calls.
- Merge-train session `019fe2b8-5a3e-7732-a98a-c2776dee27f9` covered #159/#164
  plus adjacent planning over about 2h46m and recorded 91 `spawn_agent`, 740
  `wait_agent`, 203 `send_message`, and 112 `list_agents` calls.
- These whole-session counts do not prove per-PR causality, but they support the
  user's repeated observation that bounded work was over-planned, over-reviewed,
  and over-polled.

## Fail-closed classifier

The classifier is deterministic code loaded from trusted `main`, not imported or
executed from the PR. It receives the exact base SHA, head SHA, GitHub changed-file
list, and selected blobs as inert data. It emits a versioned decision:

```text
{schemaVersion, classifierVersion, pr, baseSha, headSha, changedFileDigest,
 tier, reasons[], dependencyEvidence, expectedChecks[], settleMinutes}
```

Any read/API/parser error, unsupported file, missing dependency proof, change to
the classifier/gate itself, or contradiction escalates to T3. It never returns a
lower tier on incomplete evidence.

### Tier definitions

| Tier | Allowed change | Validation | Forced escalation |
| --- | --- | --- | --- |
| T0 | Allowlisted docs and inert deterministic configuration | formatting/link/schema checks; targeted dependency/security checks if applicable | Runtime config; CI/workflows; Forge gates; auth/security/release config; classifier; migration tooling |
| T1 | One bounded UI or leaf workspace with no API/data/auth/security/release effect | affected lint, types, unit/component tests, dependency/security checks, affected build | Cross-workspace behavior, shared contract, backend, DB dependency, ambiguous ownership |
| T2 | Cross-application or API behavior without schema/auth/security/release impact | T1 plus impacted integration/e2e and contract compatibility | Tenant/identity/auth/security, migration/schema, irreversible/release operation |
| T3 | Neon schema/migrations, tenant/identity mapping, auth, security, release/irreversible work, classifier/gate/controller changes, or any ambiguity | full applicable suite including real-Neon DB Contract and complete security evidence | Never auto-downgraded |

T0 deterministic configuration is an explicit allowlist, not “all config.” The
initial allowlist should be limited to known inert files such as formatting,
spelling, and documentation metadata. `.github/workflows/**`, `.forge/**`,
`AGENTS.md`, auth/security policies, release/deploy configuration, package
manager lifecycle configuration, migration tooling, and
`scripts/delivery/**` are always T3.

### Dependency and DB relevance

Full real-Neon DB Contract runs only when at least one condition is true:

- `apps/platform-api/**` changes;
- `packages/db/**` or migration SQL/journal/snapshot changes;
- DB Contract/migration workflow or harness changes;
- a manifest/lock delta is proven to change the platform API/database runtime
  dependency closure, including Neon/Postgres/Drizzle drivers; or
- the closure cannot be proven safe.

For root `package.json` or `bun.lock` changes, a trusted parser compares both
manifest and lock graphs at exact base/head. It treats lock data as data, verifies
frozen-lock consistency, and records the changed dependency closure. A UI-only
dependency change can remain T1/T2 only with positive proof that no DB/runtime
driver closure changed. Missing/ambiguous/transitive evidence is T3.

Every broader lockfile change still runs cheap migration integrity: frozen
install, migration journal/SQL parity, schema snapshot/catalog unit tests, DB
package typecheck/unit tests, and a zero-skips/zero-tests assertion. This keeps
fast structural coverage even when full Neon is unnecessary.

## One stable required `delivery-gate`

### Trust boundary

A normal PR workflow can be modified by the same PR, and all Actions workflows
share the GitHub Actions app identity. A name-only `delivery-gate` is therefore
not sufficient for fail-closed enforcement.

Use a least-privilege repository GitHub App (`Product-Suite Delivery Gate`) to
open and complete the `delivery-gate` check on the exact head SHA. Branch
protection binds the required check to that App ID. The trusted controller:

1. runs from the default-branch workflow on `pull_request_target` but never
   checks out, imports, installs, evaluates, or executes PR code;
2. reads PR metadata and blobs only through structured APIs;
3. runs the classifier version from trusted main;
4. dispatches a default-branch validation workflow with immutable PR/base/head,
   digest, tier, and expected-check inputs;
5. verifies workflow identity, controller SHA, exact input/output SHA, selected
   job conclusions, skip/test counts, artifact digest, machine-readable Forge
   issue link and the applicable human-gate evidence on a fresh runner;
6. keeps the App check pending through the tier settle interval, resetting on
   any head, base, classification, review-decision, or thread change; and
7. completes the exact-head App check only when every expected result is green.

GitHub explicitly warns not to execute untrusted head code in
`pull_request_target`/privileged contexts:
<https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target>.

### Validation jobs

- `classify`: always runs, validates exact SHAs/digest, and chooses the tier.
- `targeted`: T0/T1 affected lint/types/unit/component/security/build checks.
- `integration`: T2 impacted contract/integration/e2e checks.
- `db-integrity-fast`: all relevant manifest/lock/migration changes.
- `t3-security`: complete security/auth/tenant suite selected for T3.
- `t3-neon`: full ephemeral-Neon DB Contract, migrations, rollback, catalog,
  concurrency, idempotency, tenant/permissions, cleanup and zero-skip proof.
- `aggregate`: a fresh trusted job validates that the classifier-selected jobs
  ran and passed; skipped/missing/neutral/unknown expected jobs fail.

The controller never exposes `NEON_API_KEY` to install, application, or test
code. Branch creation/deletion steps alone receive a restricted Neon credential.
Tests receive only a disposable branch URL with TTL and mandatory final cleanup.
T3 runs require the protected `neon-contract` environment and explicit gate
approval; forks and unapproved heads fail closed.

## Settling policy

Target policy after enforcement proof:

| Tier | Settle after last selected exact-SHA check |
| --- | ---: |
| T0 | 0 minutes |
| T1 | 2 minutes |
| T2 | 5 minutes |
| T3 | 10 minutes |

The clock resets on head/base movement, new review/thread activity, classifier
version/digest change, check regression, or approval change. `delivery-gate`
remains pending until the interval expires, making the interval branch-protected
rather than advisory.

Rollout initially keeps Forge's global 10-minute interval. Shortening is allowed
only after the App-bound required aggregate has shadow/dual-enforcement proof and
either Forge learns to verify its signed tier evidence or the required App check
itself is accepted as the non-bypassable settle authority. Never set global
settle to zero while the aggregate can be spoofed or omitted.

## Exact-SHA single-flight merge queue

Native GitHub merge queue is a future option only after moving the repository to
a qualifying organization and adding `merge_group` triggers. Current-state
design uses a custom single-flight controller:

1. Admission requires the approved Forge issue/plan, explicit current-stage
   human gate, queue label, machine-readable issue ID, exact head, and a live
   queue/issue lease. The PR link must resolve to the same live Kernel issue and
   approved head; absent or mismatched links fail before the settle clock.
2. A non-canceling `product-suite-main-queue` concurrency lease permits one PR.
   No usable Forge broker/lease proof means no merge.
3. The worker fetches current main, proves the recorded base, and rebases exactly
   one queued branch in a clean temporary worktree. Push uses
   `--force-with-lease=<branch>:<old-head>`; mismatch aborts without overwrite.
4. The new SHA invalidates all old evidence. The controller reclassifies and
   reruns `delivery-gate` for the exact rebased SHA.
5. After gate success, the worker re-proves issue lease, base/head equality,
   mergeability, review decision/human gate, zero unresolved threads, App-bound
   check identity, and no new activity.
6. Merge uses guarded squash with the expected head SHA. No child stacked PR is
   merged while based on a feature branch.
7. Post-merge verification proves landing/tree/patch identity and selected
   exact-main CI/deploy health before issue closure or clean-worktree pruning.

For squash-stacked work, record the reviewed parent head, then restack the child
with `rebase --onto <parent-merge-sha> <old-parent-head>` (or recreate and
cherry-pick only child commits), prove patch identity, and rerun its tier gate.

## Smaller PR and agent policy

- Target roughly 300 authored changed lines when the concept remains coherent
  and independently reversible. Generated locks, snapshots, and machine output
  are reported separately and excluded from the authored target, never hidden.
- A larger slice requires a PR-template reason, explicit rollback boundary, and
  reviewer confirmation. Do not split a migration from the minimum atomic
  contract/rollback proof merely to hit a number.
- T0/T1: one owner and at most one independent reviewer. No automatic planner +
  challenger + spec reviewer + quality reviewer chain. Batch all feedback into
  one correction SHA.
- T2: one owner, one independent reviewer, and one specialist only when a named
  contract/risk requires it.
- T3: main orchestrator plus non-overlapping domain owners and one independent
  security/data challenge. Human gates and real evidence remain mandatory.
- CI/event-driven waiting replaces conversational polling. One monitor owns the
  queue; other agents work independent value or stop.

## Deterministic worktrees

One command should:

1. fetch the default branch and resolve a 40-character `origin/main` SHA;
2. fail if fetch/auth/base identity is unknown;
3. create the issue-linked worktree from that exact SHA and record it in a
   machine-readable marker;
4. prove `HEAD == recorded base`, zero initial behind count, correct branch and
   clean status;
5. run `bun install --frozen-lockfile` with the supported shared Bun cache but an
   isolated worktree install, then verify executable/package resolution;
6. copy only allowlisted non-secret environment templates and report missing
   required variables without printing values;
7. derive stable, collision-checked development ports from issue/worktree ID;
8. run the tier baseline or record an explicit failure before DEV; and
9. prune only after verified merge, exact-main health, clean status, no unpushed
   commits/stash, and live lease proof. Dirty/material worktrees are never
   automatically removed.

This work must coordinate with the existing per-worktree Bun-link corruption
issue rather than invent a second dependency strategy.

## Risk-aware PR template

Add `.github/PULL_REQUEST_TEMPLATE.md` with required concise sections:

- Forge issue/approved plan and exact base/head;
- machine-readable `Forge-Issue` and human-gate evidence that repo tooling can
  resolve and compare with the queued issue/head;
- proposed tier, classifier version/reasons, and escalation status;
- authored/generated line counts, conceptual slice and rollback boundary;
- affected workspaces/contracts plus tenant, identity, auth, security, Neon,
  migration and release impact;
- selected validation matrix, zero-skip evidence, settle interval and exact
  `delivery-gate` URL;
- deployment/rollback/cleanup proof;
- human gates obtained/still required;
- owner and single reviewer/specialist rationale; and
- correction pushes (target <= 1) and stacked-PR parent/patch identity.

## Metrics

Record privacy-safe immutable events keyed by Forge issue, PR, exact SHA, tier,
and classifier version. Do not store source, prompts, secrets, database URLs, or
personal content.

| Metric | Start -> end |
| --- | --- |
| Idea-to-PR | issue `created_at` -> PR `createdAt` |
| Plan/DEV | plan approval -> DEV start -> first implementation commit |
| PR-to-review | PR open -> first actionable independent review |
| CI queue / runtime | workflow queued -> first job; first job -> last selected job |
| Merge waiting | last selected green -> merge |
| Agent waiting | explicit wait-tool/event duration, separated from active tool work |
| Rework | actionable review -> correction push; correction-push count |
| Deployment | merge -> deployment terminal/healthy |
| Change failure | revert, rollback, hotfix, failed deployment or incident within 7 days |

Dashboards report P50/P75 by tier, false-positive/false-negative classifier
audits, unnecessary Neon runs, stale-base worktree rate, authored PR size, review
rounds, and change-failure rate. PR #159/#164 remain the initial two-point
baseline, not a statistically sufficient target verdict.

## Affected workflows and configuration

Proposed implementation surface (exact final names may change only by an
approved plan amendment):

- `scripts/delivery/classify-change.mjs`
- `scripts/delivery/verify-gate-result.mjs`
- `scripts/delivery/worktree-bootstrap.mjs`
- `scripts/delivery/metrics.mjs`
- `test/delivery-classifier.test.js`
- `test/delivery-gate.test.js`
- `test/delivery-worktree.test.js`
- `test/repo-tooling.test.js`
- `.github/workflows/delivery-controller.yml`
- `.github/workflows/delivery-validate.yml`
- `.github/workflows/delivery-queue.yml`
- `.github/workflows/db-contract.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.forge/config.yaml`
- `AGENTS.md`, `skills/validate/SKILL.md`, `skills/ship/SKILL.md`, and generated
  mirrors through the repository's normal sync mechanism

## Rollout and rollback

1. **Baseline/shadow:** classifier and aggregate report-only; keep all five
   required contexts and global 10 minutes. Measure at least ten representative
   PRs including lock, DB, UI, docs, cross-app and security fixtures.
2. **Dual enforcement:** require App-bound `delivery-gate` plus the existing five.
   Prove every PR receives exactly one exact-head aggregate and no N/A pending
   check. No legacy context is removed yet.
3. **Aggregate authority:** after repeated parity, remove legacy contexts from
   branch protection one at a time while retaining them as informative checks;
   scope Forge `checks_green.only` to the App-bound aggregate. Any mismatch
   restores the old contexts immediately.
4. **Queue dry-run:** single-flight controller computes/rebases/validates but does
   not merge. Compare its verdict with manual guarded merge snapshots.
5. **Queue T0/T1:** enable guarded merge for approved low-risk PRs, initially
   retaining 10 minutes. Expand to T2 only after latency and failure targets hold.
6. **T3 last:** require protected Neon/security environments, migration/rollback
   evidence and human approval. Production/live Neon operations remain separate.
7. **Tier settling:** adopt 0/2/5/10 only after non-bypassable tier evidence is
   proven and rollback has been rehearsed.

Rollback is configuration-first and does not rewrite history:

- disable queue admission and leave PRs open;
- restore the five legacy required contexts before removing `delivery-gate`;
- restore the broad DB Contract trigger if dependency classification misses or
  cannot prove a case;
- restore global 10-minute settling;
- revert controller/classifier commits with `git revert`;
- retain metrics/evidence and quarantine suspect classifications; and
- never roll back by weakening tests, bypassing hooks, force-pushing main, or
  mutating live Neon.

The only normal merge path is the exact-head Forge guarded command/controller.
Any GitHub direct-merge fallback requires an explicit break-glass human event,
records why the issue link/gate could not be satisfied, and creates a follow-up;
it is not counted as queue success.

## Validation matrix

| Scenario | Expected tier/result |
| --- | --- |
| Docs-only allowlist | T0; stable gate emitted; no full Neon |
| Inert formatting config | T0 only when explicitly allowlisted |
| One UI component/test | T1; affected lint/types/component/build |
| Shared API contract across apps | T2; impacted integration/e2e |
| Auth, tenant or identity code | T3; full security/isolation suite |
| Migration/schema/catalog change | T3; full real-Neon + rollback/concurrency/idempotency |
| Root lock changes UI closure only | T1/T2 plus fast DB integrity; no full Neon only with positive proof |
| Neon/Drizzle/Postgres transitive lock change | T3 and full Neon |
| Unknown/parse/API error | T3 or gate failure, never lower |
| Classifier/workflow/.forge change | T3 using trusted-main classifier |
| Required job skipped/missing/zero tests | aggregate failure |
| Head/base/thread/review changes during settle | reset and rerun exact SHA |
| Queue force-with-lease mismatch | abort; no overwrite/merge |
| Missing/mismatched PR Forge issue or human-gate link | aggregate/queue failure |
| Stale/dirty worktree cleanup | refuse and report |
| Neon cleanup failure | T3 gate failure plus TTL/reconciliation evidence |

## Risks and controls

- **Classifier false negative:** fail closed on ambiguity; shadow audits; T3 for
  classifier changes; random human sampling and incident backtesting.
- **Required-context spoofing:** dedicated App-bound check; trusted-main
  controller; no head execution in privileged context.
- **Secret exfiltration:** least privilege, protected environment, branch-only
  Neon credentials, secret-free installs/tests, mandatory TTL/delete proof.
- **Queue race/stale evidence:** exact SHA/base, force-with-lease, single-flight
  lease, gate reset, final live snapshot.
- **Check migration gap:** dual-require before removal; restore old contexts first.
- **Over-fragmentation:** 300 lines is a target, not an atomicity override;
  generated files reported separately.
- **Personal-repo platform limits:** use custom controller now; native queue only
  after an explicit organization-migration decision and `merge_group` proof.
- **Metrics gaming/privacy:** server-derived timestamps, immutable schema, no
  prompt/content capture, clearly separate active, wait, CI and human time.

## Related Forge work

- `70d277e1-4b77-4ca8-8e8a-4a6b536e2db4`: narrower duplicate CI/deployment
  cleanup; reuse its inventory, do not absorb unrelated provider retirement.
- `3d1e6478-4b33-42f6-83c7-db5f8e9f45ac`: stable required-check protection;
  superseded in mechanism by App-bound `delivery-gate`, retained as linked scope.
- `9a808ed4-16c1-48c7-8ffb-2e8a2c8aaaaf`: approved PLAN for DB Contract
  runtime reduction. Its PR #165 landing dependency is satisfied, but DEV still
  waits for exact-main DB Contract terminal success and human approval. This plan
  consumes its 8-15 minute goal without rewriting its Neon-isolation design.

## Human checkpoint

The next authorized action is review of this plan and `tasks.md`. DEV may start
only after explicit human approval, confirmation that PR #165 exact-main DB
Contract is terminal-success, a fresh fetch/rebase onto then-current main,
re-proven issue lease, and re-verification that active PR/worktree state does not
conflict. SHIP, branch-protection changes, queue activation, merge, deployment,
credential changes, and live Neon operations each retain their own gates.
