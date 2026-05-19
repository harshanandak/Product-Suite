# PR11 Planning And Charting Blocks Research

Date: 2026-05-18
Status: planned

## Live State

- PR10 Canvas Boundary Extraction merged as GitHub PR #11 at `2026-05-18T15:07:07Z`.
- `main` was fast-forwarded to merge commit `cec3a60684ab41155ca6e60587aa65b0916d1fbe`.
- Default-branch CI after the merge is green for Meeting Web CI, Meeting API CI, Roadmap Web CI, Roadmap Web Playwright, and Repo Tooling CI.
- PR10 Beads issue `product-suite-c46` was closed after verification.

## Codebase Findings

- `packages/README.md` already lists future `ui-planning` and `ui-charting` packages.
- Existing package pattern is small, private, React-peer packages:
  - `packages/ui-meeting`
  - `packages/ui-chat`
  - `packages/ui-canvas`
- Root tooling currently validates `contracts`, `sdk`, `ui-meeting`, `ui-chat`, and `ui-canvas`; PR11 must extend the same workspace, CI path filter, validation doc, and repo-tooling guard pattern for new packages.
- Planning surfaces are concentrated in Roadmap workspace components:
  - `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/_components/work-items-view.tsx`
  - `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/_components/timeline-view.tsx`
  - `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/_components/dashboard-view.tsx`
- Charting surfaces are concentrated in Roadmap analytics components:
  - `apps/roadmap-web/src/components/analytics/metric-card.tsx`
  - `apps/roadmap-web/src/components/analytics/charts/*`
  - `apps/roadmap-web/src/components/analytics/dashboards/*`
  - `apps/roadmap-web/src/components/analytics/widgets/*`
- `work-items-view.tsx` contains large dummy datasets. PR11 should not extract or bless dummy data as shared package API.
- `timeline-view.tsx` is mostly shell mapping from Roadmap DB-shaped work items into `@/components/timeline/timeline-view`. PR11 can extract the pure mapping shape or a small reusable timeline summary block, but should not move the full Gantt implementation.
- `metric-card.tsx` is a low-risk charting candidate because it is presentational and does not fetch data.

## Recommended Slice

Create two packages:

- `@product-suite/ui-planning`
  - Pure planning record types.
  - Work-item/timeline grouping helpers.
  - Small presentational summary/list block that receives shell-supplied callbacks and class names.
- `@product-suite/ui-charting`
  - Metric card and chart datum helpers.
  - No Roadmap route, Supabase, API, or analytics dashboard ownership.

## Out Of Scope

- No API routes move.
- No Supabase query changes.
- No AI tool or agent orchestration changes.
- No full Gantt/timeline engine extraction.
- No analytics dashboard builder extraction unless it is needed to consume a lower-level charting block.
- No new charting library.

## Risks

- Extracting too much from `work-items-view.tsx` could turn dummy data and Roadmap-specific task semantics into package API.
- Moving chart components that depend on `@/components/ui/*` aliases would leak app-shell design-system assumptions into packages.
- Recharts components can be harder to test in SSR package tests; keep first charting slice focused on SSR-safe metric cards and pure data helpers unless a client-only chart primitive is needed.

## TDD Scenarios

1. `ui-planning` renders work items and timeline labels from plain records without Roadmap imports.
2. `ui-planning` grouping helpers preserve input order and do not mutate caller-owned arrays.
3. `ui-charting` renders metric card values, descriptions, and trend direction without Roadmap imports.
4. Root repo-tooling tests fail until new package scripts, workspace entries, and CI path filters include both packages.
5. Roadmap integration tests fail until the app consumes the shared package exports instead of duplicating the lower-risk UI logic.
