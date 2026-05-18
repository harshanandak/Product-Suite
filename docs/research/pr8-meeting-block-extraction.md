# PR8 Meeting Block Extraction Research

Date: 2026-05-18

## Scope Verified

- `docs/plans/building-blocks-transformation-pr-plan.md` names `PR8 Meeting Block Extraction` as the next slice after merged PR7.
- GitHub PR #8 merged PR7 into `main` before this PR8 slice started.
- Beads issue `product-suite-613` tracks this PR8 slice.

## Codebase Findings

- The strongest extraction candidate is `apps/meeting-web/src/components/meeting/SummaryFirstMeetingScreen.jsx` plus its panel helpers.
- `SummaryFirstMeetingScreen` is mostly presentation-only, but it imports meeting-web shell widgets from `../buddy/BuddyControls` and `../chat/ChatPanel`.
- The meeting create screen imports meeting-web-local shadcn aliases and lucide icons, so it is a riskier extraction target for the first shared UI package.
- `roadmap-web` has no meeting-specific UI surface yet, but its workspace dashboard can consume a packaged meeting summary block as a low-risk reusable surface without adding meeting-api runtime coupling.
- Repo tooling currently knows `packages/contracts` and `packages/sdk`; PR8 must add `packages/ui-meeting` to workspaces, CI path filters, and focused tooling tests.

## Technical Approach

Create `packages/ui-meeting` as a React presentation package with no router, data fetching, auth, SDK, or shell dependencies. The initial public API should expose:

- `MeetingSummaryBlock`
- `formatConfidence`
- `resolveStatusLabel`

`meeting-web` keeps its existing shell widgets and data hooks, but imports the shared block from `@product-suite/ui-meeting`. The package accepts optional `buddySlot` and `chatSlot` render props so shell-specific panels stay outside the package.

`roadmap-web` consumes the package through a small workspace meeting component with sample/empty-state data. This proves package-level reuse without coupling Roadmap to Meeting API.

## TDD Scenarios

1. Package export smoke test renders `MeetingSummaryBlock` with decisions, actions, questions, transcript lines, and chapters.
2. Package test verifies empty-state behavior for first meeting and prior-history chooser states.
3. Meeting-web test verifies the existing summary screen keeps shell buddy/chat content while delegating the shared presentation block.
4. Roadmap-web test verifies a Roadmap component imports and renders the shared package.
5. Repo-tooling test verifies `packages/ui-meeting` is wired into root workspaces and CI path filters.

## Risks

- Pulling app UI primitives into the shared package would make it one-app-only. Avoid by using Tailwind class markup and slot props.
- Pulling data hooks into the package would create runtime coupling. Keep data loading in app shells.
- `roadmap-web` uses TypeScript and Next while `meeting-web` uses Vite/JS. Keep the package export plain ESM React to work in both.
