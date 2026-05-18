# PR8 Meeting Block Extraction Design

## Feature

- Slug: `pr8-meeting-block-extraction`
- Date: 2026-05-18
- Status: planning
- Beads: `product-suite-613`

## Purpose

Extract the first reusable meeting presentation block so `meeting-web` becomes thinner and `roadmap-web` can render the same meeting surface through a package import.

## Success Criteria

- `packages/ui-meeting` exists as a first-class workspace package.
- `meeting-web` imports meeting summary presentation from `@product-suite/ui-meeting`.
- `roadmap-web` imports and renders a meeting surface from `@product-suite/ui-meeting`.
- The package has focused tests for rendering, defaults, and reusable helper exports.
- Existing meeting-web summary tests remain green.
- Repo-tooling tests and CI path filters know about `packages/ui-meeting`.

## Out Of Scope

- No Meeting API ownership changes.
- No Roadmap data persistence for meetings.
- No chat extraction; that is PR9.
- No canvas/provider extraction; that is PR10.
- No routing, auth, SDK, or fetch logic inside `packages/ui-meeting`.

## Approach Selected

Create a small ESM React package that owns only meeting presentation. Extract the existing summary-first screen into a package component named `MeetingSummaryBlock`, then keep app-specific buddy/chat panels in `meeting-web` through slot props.

This keeps the package reusable across Vite and Next while avoiding route, auth, and app-shell coupling.

## Constraints

- Shared package must not import `@/` aliases.
- Shared package must not import app-local hooks, route helpers, SDK clients, or shell widgets.
- Roadmap consumption must be minimal and non-invasive.
- Source changes must include corresponding tests.

## Edge Cases

- No active meeting and no history: render first-meeting empty state.
- No active meeting with history: render chooser empty state.
- Active meeting with missing summary state: render defaults without crashing.
- Generated records with missing confidence or status: render existing default labels.
- App-specific buddy/chat panels: passed as slots and omitted by default.

## Ambiguity Policy

Use the existing `/dev` decision gate rubric. If the package would need router state, auth/session state, or persistence policy to satisfy an extraction decision, stop and leave that behavior in the app shell.
