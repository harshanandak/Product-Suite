# PR1 Repo Tooling Normalization Decisions

## 2026-04-23 - Keep `meeting-api` outside Bun workspaces

- Decision: document `apps/meeting-api/backend` as a first-class deployable service without adding it to the root Bun workspace list.
- Rationale: `meeting-api` is a Python/FastAPI runtime, while the root Bun workspace currently owns the JavaScript web apps. Adding the Python backend to Bun workspaces would blur runtime ownership and create false package-manager assumptions.
- Chosen option: keep `meeting-api` documented in `README.md` and `docs/deployment/SERVICE_INVENTORY.md`; leave root `workspaces` limited to `apps/meeting-web` and `apps/roadmap-web`.
- Alternatives considered: add `apps/meeting-api/backend` to root workspaces, or move it under `services/` in PR1.
- Why alternatives were rejected: Bun workspace membership does not fit the Python runtime, and moving runtime paths in PR1 would introduce deployment risk outside repo-tooling normalization.
- Author: Codex
- Timestamp: 2026-04-23
- Evidence: PR #1, commit `675aa83`.
- Follow-up: a later PR can add language-specific service tooling if the backend needs root orchestration.

## 2026-04-23 - Reserve building-block directories without moving code

- Decision: create documented `packages/` and `services/` roots as reserved boundaries, but do not extract or move runtime code in PR1.
- Rationale: the architecture direction needs clear building-block seams, but PR1 is a topology/tooling normalization step and should avoid behavioral churn.
- Chosen option: add `packages/README.md` and `services/README.md` explaining intended future ownership.
- Alternatives considered: immediately extract shared packages or move backend services.
- Why alternatives were rejected: extraction and path moves require separate validation, deployment updates, and reviewer focus.
- Author: Codex
- Timestamp: 2026-04-23
- Evidence: PR #1, commit `675aa83`.
- Follow-up: extraction PRs should use these directories only after contracts and ownership are defined.

## 2026-04-23 - Fix validation gates as part of ship readiness

- Decision: include minimal validation fixes discovered during `/validate` and `/ship` so PR1 can pass the repository gates.
- Rationale: the PR could not safely ship while lint, build, audit, and root preflight gates were blocked by tooling drift.
- Chosen option: fix the invalid Bun CI command form, add a root repo-tooling test, make Parallel client initialization lazy, remove stale ESLint suppressions, and update vulnerable dependency pins/overrides.
- Alternatives considered: bypass the ship gate or leave follow-up blockers.
- Why alternatives were rejected: bypassing validation would weaken the PR1 tooling baseline this PR is meant to establish.
- Author: Codex
- Timestamp: 2026-04-23
- Evidence: PR #1, commit `e929743`.
- Follow-up: future PRs should keep root validation scripts aligned with app-level CI.
