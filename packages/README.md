# Packages

This directory is reserved for shared building blocks that will be extracted in later PRs.

Nothing in `packages/` is canonical yet. During `PR1 Repo Tooling Normalization`, this directory exists only to make the planned monorepo shape explicit.

Future examples:

- `contracts`
- `sdk`
- `adapters`
- `ui-chat`
- `ui-meeting`
- `ui-canvas`
- `ui-planning`
- `ui-charting`

`ui-planning` and `ui-charting` are introduced in PR11 as shell-agnostic presentation packages. Roadmap remains responsible for data loading, routing, permissions, and workspace orchestration.
