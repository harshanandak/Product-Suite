# PR11 Planning And Charting Blocks Design

Feature: `pr11-planning-and-charting-blocks`
Date: 2026-05-18
Status: locally validated for ship
Beads: `product-suite-w4r`
Decisions: `docs/plans/2026-05-18-pr11-planning-and-charting-blocks-decisions.md`

## Purpose

Extract the lowest-risk planning and charting presentation blocks after PR10 proved the shared-package path for canvas boundaries. This should reduce Roadmap shell bulk while keeping Roadmap-specific routing, persistence, workspace orchestration, and AI tools inside `apps/roadmap-web`.

## Success Criteria

- `packages/ui-planning` exists with pure planning types/helpers and SSR-tested reusable planning presentation.
- `packages/ui-charting` exists with SSR-tested reusable charting/metric presentation and pure helpers.
- `apps/roadmap-web` consumes at least one export from each package.
- Root validation, repo-tooling tests, and CI path filters include both packages.
- Existing Roadmap tests and build remain green.

## Out Of Scope

- Moving Supabase data access or route handlers.
- Moving AI agent planning tools.
- Moving full Gantt/editor/canvas behavior.
- Replacing existing charting libraries.
- Extracting Roadmap dummy data as shared package API.

## Approach Selected

Use the same small private-package pattern already proven by `ui-meeting`, `ui-chat`, and `ui-canvas`.

`ui-planning` will start with plain record types, deterministic helper functions, and a small presentation block. `ui-charting` will start with metric/trend presentation and pure chart data helpers. Roadmap wrappers will continue to own workspace IDs, data fetching, callbacks, permissions, and route decisions.

This is preferred over moving the full `work-items-view`, analytics dashboards, or Gantt/timeline implementation because those components are still deeply coupled to Roadmap shell state and data semantics.

## Constraints

- Packages must not import `@/` aliases.
- Packages must not fetch, mutate, route, or know about Supabase.
- Package tests must prove SSR-safe rendering and pure helper behavior.
- Any new package must be wired through root workspaces, validation scripts, CI filters, docs, and repo-tooling tests.

## Edge Cases

- Empty planning records render a stable empty state.
- Missing item titles fall back to deterministic labels without throwing.
- Unknown timeline phases group under a safe fallback.
- Trend values handle positive, negative, neutral, and missing states.
- Helper functions must not mutate caller-owned arrays.

## Ambiguity Policy

Use the existing 7-dimension decision gate. Proceed when a choice is clearly within this document's scope and confidence is at least 80%. Stop and ask before moving full Roadmap dashboards, Gantt behavior, API routes, or persistence into a package.

## Technical Research

Local research found these reusable candidates:

- `apps/roadmap-web/src/components/analytics/metric-card.tsx` is presentational and a good first `ui-charting` candidate.
- `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/_components/timeline-view.tsx` performs shell-specific mapping into a timeline component, so only pure normalization helpers or a smaller timeline summary should move.
- `apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/_components/work-items-view.tsx` contains large dummy data and should not be lifted whole.
- Root package/CI/test patterns from PR8-PR10 should be extended rather than reinvented.

OWASP notes:

- A01 Broken Access Control: not directly applicable because PR11 does not move auth, permissions, or server access checks.
- A03 Injection: package helpers render caller-supplied strings through React text nodes and must not introduce raw HTML rendering.
- A04 Insecure Design: scope control is the main mitigation; packages must stay presentational and cannot own persistence decisions.
- A05 Security Misconfiguration: CI path filters must include both packages so package changes cannot bypass validation.
- A08 Software And Data Integrity Failures: tests must assert package helpers are deterministic and do not mutate input records.

TDD scenarios:

1. `ui-planning` renders provided work item records and an empty state without Roadmap imports.
2. `ui-planning` groups timeline records deterministically and preserves caller input order.
3. `ui-charting` renders metric card value, description, and trend affordance without Roadmap imports.
4. Repo-tooling test fails until workspace/scripts/CI/docs include the new packages.
5. Roadmap integration test fails until Roadmap consumes package exports.

## Validation Evidence

Captured on 2026-05-19 before shipping PR11:

- `bun run check:source-test`
- `bun run test:ui-planning`
- `bun run test:ui-charting`
- `bun run test:repo-tooling`
- `bun run --cwd apps/roadmap-web test src/components/analytics/__tests__/pr11-shared-packages.test.tsx src/components/analytics/metric-card.test.tsx "src/app/(dashboard)/workspaces/[id]/_components/__tests__/timeline-view.test.tsx"`
- `bun run --cwd apps/roadmap-web typecheck`
- `bun run test:prepush`
