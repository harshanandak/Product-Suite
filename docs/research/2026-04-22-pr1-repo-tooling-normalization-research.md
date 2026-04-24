# PR1 Repo Tooling Normalization Research

## Verified Current State

- Root Bun workspaces currently include only `apps/meeting-web` and `apps/roadmap-web`.
- `meeting-api` already exists as a separate Python service with deploy root at `apps/meeting-api/backend`.
- GitHub Actions already includes a dedicated `meeting-api` workflow, while the root Bun workspace still intentionally lists only the two JavaScript web apps.
- Service inventory already documents all three deployables.

## Implication

PR1 should normalize repo topology documentation and scaffolding around the existing shape without trying to force the Python backend into Bun workspace semantics.

## Non-Goals Confirmed

- no auth migration
- no shared contracts package
- no app or service logic migration
