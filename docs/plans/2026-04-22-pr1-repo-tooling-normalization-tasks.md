# PR1 Repo Tooling Normalization Tasks

## Task 1 - Create root scaffolding

Add minimal top-level `packages/` and `services/` directories so the repo shape matches the planned architecture.

Verify: `packages/README.md` and `services/README.md` exist and describe reserved building-block boundaries.

## Task 2 - Normalize root tooling

Update root-level repo documentation and topology notes so the repo acknowledges all current deployables, especially `meeting-api` as a first-class service without adding it to Bun workspaces.

Verify: root docs reference `meeting-api`, `meeting-web`, and `roadmap-web` without changing Bun workspace membership.

## Task 3 - Update root documentation

Add or update root-facing documentation so contributors can understand the current topology and where each deployable lives.

Verify: service inventory, research, design, and README updates are present and internally consistent.

## Task 4 - Verify no behavior changes

Run targeted validation to confirm this PR only changes tooling/documentation/scaffolding and does not alter app behavior.

Verify: `bun run ci:meeting-web`, `bun run ci:roadmap-web`, `bun audit`, and root repo-tooling tests pass.

TDD note: classic RED-GREEN-REFACTOR is not applicable to PR1 topology documentation and scaffolding. Verification is expressed as executable repo tooling checks plus file-presence/documentation consistency checks.
