# PR1 Repo Tooling Normalization Design

## Goal

Make the repo topology truthful without changing product behavior.

This PR must normalize root-level tooling and documentation so the repository clearly represents the current deployables:

- `apps/roadmap-web`
- `apps/meeting-web`
- `apps/meeting-api/backend`

## Scope

In scope:

- root tooling and docs
- service inventory updates
- root-level directory scaffolding for future `packages/` and `services/`

Out of scope:

- auth changes
- shared contracts extraction
- SDK extraction
- app shell refactors
- service logic changes

## Constraints

- Do not force `meeting-api` into Bun workspaces.
- Do not change app runtime behavior.
- Do not change deployment roots.
- Keep future-facing scaffolding minimal and non-invasive.

## Expected Outputs

- root repo documentation reflects the real topology
- top-level `packages/` and `services/` directories exist for future PRs
- service inventory stays aligned with the plan

## Ambiguity Policy

If a change would alter deploy behavior, CI behavior, or package-manager semantics beyond documentation and explicit root command additions, do not include it in this PR.
