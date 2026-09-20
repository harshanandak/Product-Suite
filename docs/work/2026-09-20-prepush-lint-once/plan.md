# Run local pre-push lint once

Issue: `e54d032b-92f6-4500-adf8-5e59ffba57d2`.
Classification: Refactor. User authorized delivery efficiency before the selective architecture baseline reset.

## Purpose and success

The current Lefthook pre-push path runs root workspace lint and then repeats workspace lint inside selected verification suites. Keep all existing local checks, execute root lint once, and preserve canonical CI plans and verification scripts.

Success means docs, scoped, full and fast plans contain one aggregate lint before their remaining checks. A lint failure stops execution. Direct gate invocation is equally safe. First-push, unknown-path and empty-range fallbacks retain full coverage. Required GitHub contexts and strict freshness are unchanged.

## Design and technical evidence

Initial source review used fetched `origin/main` at `9cf66fa31cb422c1d06b5d1e2da476950b404681`. At that baseline, root `lint` covered five workspaces and Roadmap depended on it because its mapped local suite was only a boundary test. Main `499cc401efeec02eaa0b6bea5c04e2b34ae3d20f` later retired the Roadmap runtime; root `lint` now covers the four supported lint-bearing workspaces. Simply removing aggregate lint would still lose unaffected-workspace coverage.

Move aggregate lint ownership from `lefthook.yml` into `scripts/prepush-gate.mjs`. Reuse its command-descriptor runner. Expand only four local `verify:*` suites into their existing non-lint steps: platform-web, platform-api and db retain typecheck plus tests; meeting-web retains tests. Other suites keep their current command. Fast plans retain existing typechecks and test-only suites while removing duplicated workspace lint. Canonical `SUITES`, `suitesFor`, `buildCiPlan`, root scripts and CI workflows remain unchanged.

No new dependency, package alias, service, receipt mechanism or configuration flag is needed. The only command inputs remain checked-in descriptors; retain argument-array execution and error propagation.

## Scope and rollback

Six implementation/test files: `lefthook.yml`, `scripts/prepush-classify.mjs`, `scripts/prepush-gate.mjs`, `test/prepush-classify.test.js`, `test/prepush-gate.test.js`, `test/branch-protection.test.js`.

Out of scope: reducing aggregate lint coverage, moving tests to CI, changing required checks, database preparation, worktree bootstrap, product architecture and unrelated existing failures. Revert this focused commit to restore the prior hook and runner path.

## Validation and delivery

Use existing test helpers for executed RED then GREEN regressions. Check the actual dry-run command plan across all modes and use minimal real runner smoke tests for direct execution and lint-failure propagation; the common executor consumes that same plan. This avoids repeating every full command matrix in Windows subprocesses. Prove test-only suites survive fast mode, fail-closed range/path handling remains, canonical CI output is unchanged, and local verification remainders match the canonical scripts with only lint removed. Run focused tests, repository-tooling suite and normal configured push gates. Review spec compliance before code quality/security. Confirm latest-base freshness, exact-head CI and review state before merge-ready handoff. Human merge remains the checkpoint.
