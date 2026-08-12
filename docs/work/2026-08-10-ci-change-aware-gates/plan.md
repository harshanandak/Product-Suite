# CI change-aware gate ordering

- Feature: `ci-change-aware-gates`
- Date: 2026-08-10
- Status: approved for implementation
- Forge issue: `532329e0-7595-40c2-b939-a3a0735f8071`
- Classification: Standard CI/reliability enhancement

## Purpose

Stop spending protected Neon/DB-contract capacity on a commit that has already failed a cheaper relevant test, lint, typecheck, or repository-integrity check. Select those cheap checks from the changed workspace plus its dependents so feedback is fast without weakening database, security, migration, or authority gates.

## Success criteria

1. The expensive credentialed DB-contract job cannot start until all cheap checks selected for the same exact commit succeed.
2. Selection reuses the repository's pure changed-surface/workspace dependency graph in `scripts/prepush-classify.mjs`; an unknown range, unowned path, root manifest/lockfile, CI/security/authority tooling, or migration/infra change fails closed to the full cheap suite.
3. A database-authority/security/migration change requires a real successful DB-contract result for the exact head SHA. A skipped job, cancelled job, missing output, malformed selector result, or `N/A` cannot satisfy that requirement.
4. A proven non-authority change emits an explicit deterministic `N/A` verdict without starting the credentialed DB job; the stable required check context remains `DB Contract / db-contract`.
5. Superseded runs cancel before consuming more capacity, using a PR-number-or-ref concurrency key that does not collide across unrelated PRs.
6. Routing and workflow invariants are covered by deterministic tests with no network, credentials, wall-clock timing, or live GitHub dependency.
7. Executable migration-manifest and OAuth/token/session authority paths fail closed without treating design tokens, non-auth application sessions, or unrelated documentation as DB-required.
8. Merge-time base freshness remains enforced by GitHub's authoritative `strict: true` branch protection; no point-in-time PR workflow claims to replace that server-side rule.
9. No product code, database migration, production secret, environment protection rule, or branch-protection configuration is changed.

## Approach selected

Use one independent implementation PR created from refreshed `origin/main` after the pending DB Contract workflow lands. Do not stack onto or edit any active PR. Extend the existing pure classifier with an explicit CI plan (`exactSha`, cheap scripts, full/scoped reason, and `dbEvidenceRequired`) and a small CLI adapter that emits validated JSON/GitHub outputs. Reshape the DB Contract workflow into four internal jobs:

1. `classify`: fetch full history, derive the event's base/head pair, assert exact checkout, and fail closed to a full plan when the range is unavailable or invalid.
2. `cheap-gates`: `needs: classify`; install once and run always-on integrity checks plus the selected workspace/dependent suites sequentially. Sequential execution matches the existing pre-push reliability decision and avoids worker oversubscription.
3. `db-contract-runtime`: `needs: [classify, cheap-gates]`; run only when `dbEvidenceRequired == true`, in the protected environment, at the classifier's exact SHA.
4. `db-contract`: stable final required-check sentinel with `if: always()`. It succeeds only when classification and cheap gates succeeded and either (a) required DB runtime succeeded with matching exact-SHA evidence, or (b) the validated plan proves DB evidence is not relevant and emits explicit `N/A`.

This is preferable to `workflow_run` because cross-workflow dependencies are indirect, harder to bind to the exact PR head, and easier to mis-handle when a workflow is skipped. It is preferable to duplicating path regexes in YAML because the existing tested dependency graph remains the single routing authority.

## Constraints

- Preserve `DB Contract / db-contract` as the required external status context.
- No hook, test, security, branch-protection, protected-environment, or exact-SHA bypass.
- Cheap gate selection may reduce irrelevant tests only for confidently scoped paths. Ambiguous input means full cheap validation and required DB evidence.
- The credentialed DB job never runs in parallel with or before its prerequisites.
- A final sentinel evaluates explicit job results and validated outputs; GitHub's default skipped-job propagation is not treated as success.
- Reuse `bun@1.3.6`, pinned actions, `fetch-depth: 0`, `persist-credentials: false`, and `bun install --frozen-lockfile --ignore-scripts`.
- Treat local ship/pre-push freshness checks as supplementary point-in-time feedback only. The server-side strict branch-protection rule is the merge authority.

## Edge cases

- Missing/zero base SHA, shallow history, invalid ref, empty diff, rename, deleted workspace manifest, or JSON parse failure: full cheap suite and DB evidence required.
- Docs-only change: integrity/source-coupling check only; explicit non-authority `N/A` is permitted after the cheap job succeeds.
- Shared package change: run that package's checks and every dependent workspace selected by the existing graph.
- Root manifest, lockfile, workflow, CI selector, security policy, database authority, migration, or infra change: full cheap suite and DB evidence required.
- Cheap job fails/cancels/times out: DB runtime never starts; final sentinel fails.
- DB runtime skips when required, reports a different SHA, produces no verdict, or is cancelled: final sentinel fails.
- New commit pushed: prior DB-contract run is cancelled by concurrency; only the new exact-head run can produce DB evidence.
- Base branch advances after a PR check: strict branch protection requires the PR branch to be current before merge; a pull-request-only workflow result is not treated as durable freshness evidence.

## Security and reliability review

- OWASP A05/A08: keep actions pinned, install lifecycle scripts disabled, permissions read-only outside the protected DB job, and treat workflow/selector changes as full-impact.
- OWASP A09: final summary records exact SHA, selection reason, selected cheap scripts, DB relevance, and each prerequisite result without secrets.
- Secret isolation: only `db-contract-runtime` receives the protected environment; classification and cheap jobs receive no Neon credentials.
- Availability: cancellation removes obsolete work; bounded timeouts prevent capacity leaks; sequential suites avoid known local oversubscription flakiness.

## TDD scenarios

1. Scoped UI change selects UI plus dependent workspace checks and `dbEvidenceRequired=false`.
2. Platform API/DB/migration/security/workflow/unknown-range inputs, including the executable migration manifest and actual OAuth/token/session authority paths, select the full cheap suite and `dbEvidenceRequired=true`.
3. Workflow fixture proves runtime `needs` cheap gates, final sentinel uses `always()`, and required DB evidence rejects skipped/cancelled/missing/wrong-SHA outcomes.
4. Docs-only plan allows explicit `N/A` only after the cheap integrity job succeeds.
5. Negative controls prove design tokens, non-auth session routing, and unrelated docs retain scoped/docs-only behavior.

## Out of scope

- Changing product tests or making failing tests optional.
- Removing existing independent workflows in the first PR.
- Reconfiguring GitHub branch protection or protected Neon environment values.
- Running real Neon tests locally or altering production data.
- General CI caching, runner sizing, or unrelated flaky-test repair.

## Ambiguity policy

Use the `/dev` seven-dimension decision rubric. Proceed only at 80% or greater confidence. Any ambiguity that could under-test authority, security, migration, or exact-head evidence fails closed and stops for review.
