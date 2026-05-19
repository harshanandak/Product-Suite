# PR11 Planning And Charting Blocks Decisions

Feature: `pr11-planning-and-charting-blocks`
Date: 2026-05-19
Author: Codex
Beads: `product-suite-w4r`

## DEC-001: Extract Only Low-Risk Presentation Blocks

- Summary: Create `packages/ui-planning` and `packages/ui-charting` for pure helpers and SSR-safe presentation components.
- Rationale: These surfaces are reusable without moving Roadmap routing, persistence, workspace orchestration, or AI behavior into shared packages.
- Consequences: Roadmap remains the shell owner for data fetching and route behavior, while shared packages own only deterministic formatting, grouping, and presentational rendering.
- Date: 2026-05-19
- Author: Codex

## DEC-002: Keep Timeline Fallback Compatible With Roadmap Filters

- Summary: Normalize timeline phases through `@product-suite/ui-planning`, then coerce `UNASSIGNED` back to `MVP` at the Roadmap wrapper boundary.
- Rationale: `CoreTimelineView` currently exposes `MVP`, `SHORT`, and `LONG` filters. Passing `UNASSIGNED` through would hide items behind an unsupported phase.
- Consequences: Shared helpers can still represent unknown phases, and Roadmap preserves its previous valid fallback behavior until the core timeline explicitly supports `UNASSIGNED`.
- Date: 2026-05-19
- Author: Codex

## DEC-003: Transpile New Workspace UI Packages In Roadmap

- Summary: Add `@product-suite/ui-planning` and `@product-suite/ui-charting` to Roadmap's `transpilePackages`.
- Rationale: Both packages export JSX source from workspace package entrypoints, so Next must transpile them during production builds.
- Consequences: Roadmap builds consume the new packages consistently with the existing shared UI packages.
- Date: 2026-05-19
- Author: Codex

## DEC-004: Enforce Source-Test Coupling In Full Prepush Validation

- Summary: Run `check:source-test` at the start of `test:prepush`.
- Rationale: The root prepush command should enforce the same source/test coupling contract as the pre-commit hook.
- Consequences: Full validation catches source changes without matching tests even when invoked outside Git hooks.
- Date: 2026-05-19
- Author: Codex
