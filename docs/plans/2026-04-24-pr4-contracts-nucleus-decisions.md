# PR4 Contracts Nucleus Decisions

Date: 2026-04-24
Status: initialized during planning

## Planning Decisions

1. PR4 stays wire-contract-first and does not unify domain ownership.
2. `packages/contracts` must be honest for Python consumption, so the plan assumes serializable contract artifacts in addition to JS-friendly exports.
3. Roadmap Playwright, meeting-web Vitest, and meeting-api pytest baselines are all green in the PR4 worktree after setup, so `/dev` can start from a clean scoped baseline.
