# PR2 Validation Baseline Design

Feature: `pr2-validation-baseline`  
Date: 2026-04-24  
Status: planned  
Issue: `product-suite-84m`

## Purpose
Create one root-level validation story for `roadmap-web`, `meeting-web`, and `meeting-api` before deeper architectural refactors. The repo should have a single documented place to run baseline validation for every deployable.

## Success Criteria
- Root `package.json` exposes explicit validation entrypoints for:
  - `meeting-web`
  - `roadmap-web`
  - `meeting-api`
- Root docs explain the local validation order and what each command covers.
- Validation commands fail loudly instead of silently skipping deployables.
- JS and Python validation coverage is explicit from the root.
- CI and local root commands no longer tell different stories about how the repo is validated.

## Out Of Scope
- Re-architecting GitHub Actions
- Adding a new monorepo task runner
- Deep Python quality expansion beyond a pragmatic baseline
- Fixing unrelated lint/test debt outside the minimum needed for the baseline
- Changing deployable ownership or package/service boundaries

## Approach Selected
Add a small root validation surface in `package.json` and align root documentation to it. Reuse existing app-level commands where they already exist. For `meeting-api`, expose root entrypoints that call the current Python toolchain directly instead of pretending it is part of Bun workspaces.

## Why This Approach
- It is the smallest change that makes validation truthful across all deployables.
- It avoids forcing Python into JS tooling abstractions.
- It gives later PRs a stable baseline gate before contracts/auth/service refactors.
- It reduces tribal knowledge without front-loading a broader CI redesign.

## Constraints
- `meeting-api` stays outside Bun workspaces.
- Root validation must be understandable to a new contributor.
- Commands must fail explicitly when prerequisites are missing.
- PR2 should prefer tools already present in the repo.

## Edge Cases
- If `meeting-api` tests require migrations or DB setup, the root docs must say so explicitly.
- If Roadmap lint is still intentionally soft in CI, the plan must call that out rather than implying hard enforcement.
- If Python lint commands prove too noisy for the first pass, PR2 should still wire the entrypoint and document the short-term scope.

## Technical Research
See [pr2-validation-baseline.md](/C:/Users/harsha_befach/Downloads/Product-Suite-pr2-validation-baseline/docs/research/pr2-validation-baseline.md).

## Ambiguity Policy
Use the existing staged workflow discipline:
- If a validation command can be added conservatively without changing app behavior, proceed and document it.
- If a command would silently redefine quality policy, stop and record the decision in the PR2 decisions log.

