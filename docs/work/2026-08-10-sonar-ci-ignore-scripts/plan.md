# Sonar CI lifecycle-script hardening

- Feature: `sonar-ci-ignore-scripts`
- Date: 2026-08-10
- Status: approved for PLAN -> DEV -> VALIDATE -> SHIP
- Forge issue: `808fbffa-8923-4083-9e5e-407b5b855454`
- Approval: issue comment `9f28ac1b-7eeb-4218-97ce-fddfffca79f1`
- Base: exact `origin/main` SHA `5a4ed8d8f52b7fe78044fac000602b9cd6552ee0`

## Purpose

Resolve the three new-code `githubactions:S6505` findings in the DB contract,
Platform Web CI, and Platform Web deploy workflows. Dependency installation must
not execute package lifecycle scripts in CI, reducing install-time supply-chain
execution without weakening lockfile integrity.

## Success criteria

1. Exactly these workflows install with
   `bun install --frozen-lockfile --ignore-scripts`:
   `.github/workflows/db-contract.yml`,
   `.github/workflows/platform-web-ci.yml`, and
   `.github/workflows/platform-web-deploy.yml`.
2. A repo-tooling regression test parses all three workflows and requires the
   exact hardened command.
3. Action SHA pins, `persist-credentials: false`, secret scoping, conditional
   execution, build commands, and deploy commands remain unchanged.
4. Focused repo-tooling, YAML/source-coupling, security, and diff checks pass.
5. The PR observes the first CI/Sonar/review wave; it is not merged by this work.

## Out of scope

- Other Sonar findings or workflow install steps.
- Sonar exclusions, issue resolutions, or quality-gate changes.
- A global `bunfig.toml` or changes to local developer install behavior.
- Dependency upgrades, action-pin changes, secret changes, or deployment changes.

## Selected approach

Keep `--frozen-lockfile` and append Bun's per-command `--ignore-scripts` flag to
the three reported workflow steps. This is narrower and more reversible than a
global configuration change, and it keeps deterministic lockfile enforcement.

## Constraints and edge cases

- The three workflow paths and their current install commands must match the
  exact base; path or command drift is a stop condition.
- The workflows must not depend on package lifecycle scripts before their test,
  build, or deploy commands. Focused validation must detect any resulting failure.
- Tests must identify steps by parsed YAML name, not by loose text occurrence.
- Rollback is the exact inverse three-line change plus the corresponding test
  expectation; no data migration or runtime rollback is involved.

## Ambiguity policy

No discretionary expansion is authorized. Any need to change another workflow,
enable a lifecycle script, alter an action pin, expose a secret, or change deploy
behavior is security-sensitive and must stop for user approval.

## Technical Research

The approved analysis identified exactly three new-code `githubactions:S6505`
findings on `bun install --frozen-lockfile`. Package lifecycle scripts execute
dependency-controlled code during installation, so disabling them in CI reduces
the opportunity for a compromised dependency to run in the runner context. This
addresses OWASP A08 (Software and Data Integrity Failures) at the install boundary.
The DB contract workflow already scopes Neon secrets only to the later required
test step; preventing install scripts adds defense in depth while preserving that
boundary. No Sonar exemption or global configuration is needed.

### TDD scenarios

1. RED: parse all three workflows and fail because each named install step lacks
   `--ignore-scripts`.
2. GREEN: after the three command-only edits, each parsed install step equals
   `bun install --frozen-lockfile --ignore-scripts`.
3. Regression: existing repo-tooling assertions continue proving the DB contract
   secret scope, exact-head behavior, and action pins; source/test coupling and
   YAML parsing remain green.
