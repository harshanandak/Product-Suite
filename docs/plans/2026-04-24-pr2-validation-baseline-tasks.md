# PR2 Validation Baseline Tasks

Date: 2026-04-24  
Issue: `product-suite-84m`

## Task 1: Inventory Current Validation Commands
- Capture the current root, app-level, and CI validation entrypoints for all three deployables.
- Verify: the inventory references `package.json`, app package scripts, and GitHub workflow files.

## Task 2: Define Root Validation Command Surface
- Add explicit root commands for:
  - `validate:meeting-web`
  - `validate:roadmap-web`
  - `validate:meeting-api`
- Add narrower backend commands if needed for install, lint, and test.
- Verify: each root command maps to a real deployable and does not silently no-op.

## Task 3: Wire Python Validation Baseline
- Add root-level Python validation commands that use the current backend toolchain.
- Keep the baseline pragmatic:
  - lint
  - test
  - documented migration prerequisite if required
- Verify: `meeting-api` is validate-able from the root without Bun workspace assumptions.

## Task 4: Align Documentation
- Update root docs so a new contributor can run validation in the correct order from the repo root.
- Explain local prerequisites and any deployable-specific caveats.
- Verify: docs and root commands describe the same validation surface.

## Task 5: Align CI Story
- Make sure local root validation naming and CI naming are not contradictory.
- Tighten obvious soft spots only if the repo can support it without pulling unrelated debt into PR2.
- Verify: CI and local validation tell one coherent story.

## Task 6: Add Baseline Tests
- Extend root-level tests to verify required validation entrypoints exist and point at the intended app/tool paths.
- Verify: the root test suite fails when a deployable loses its baseline validation command.

## TDD Note
PR2 is mostly tooling/documentation orchestration, so classic RED-GREEN-REFACTOR applies at the command-surface level:
- RED: add or extend root tests that fail when validation entrypoints are missing or miswired
- GREEN: wire the root commands and docs
- REFACTOR: simplify naming and ordering without weakening coverage
