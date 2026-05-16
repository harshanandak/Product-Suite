# PR5 Auth Contracts And Adapters Tasks

Issue: product-suite-ef5
Design: docs/plans/2026-05-16-pr5-auth-contracts-and-adapters-design.md
Research: docs/research/pr5-auth-contracts-and-adapters.md

## Task 1: Auth Contract Artifact

TDD:

1. RED: Add a failing `packages/contracts` test that expects an exported auth contract artifact with `AuthClaims`, `TokenVerifier`, `SessionBridge`, and `WorkspaceAccessResolver` sections.
2. GREEN: Add the minimal JSON artifact and exports needed to pass.
3. REFACTOR: Align naming and declarations with existing contract package style.

Validation:

- `bun run --cwd packages/contracts test`

## Task 2: Shared Auth Claim Validation

TDD:

1. RED: Add tests for valid claims and required-field failures.
2. GREEN: Add minimal JS helpers/types for validating shared auth claims.
3. REFACTOR: Keep helper output provider-neutral and token-safe.

Validation:

- `bun run --cwd packages/contracts test`

## Task 3: App Adapter Mapping Helpers

TDD:

1. RED: Add focused tests proving current meeting-web hosted auth, roadmap-web Supabase user/session, and meeting-api actor/claims shapes can map to shared auth claims.
2. GREEN: Add narrow adapter helpers next to existing auth boundaries without changing runtime provider flows.
3. REFACTOR: Remove duplication while keeping app-specific provider logic outside the contract package.

Validation:

- `bun run --cwd packages/contracts test`
- relevant focused app tests selected during implementation

## Task 4: Workflow Documentation And Stage Context

TDD:

1. RED: Add or update repo-tooling/docs tests if current docs must reference PR5 artifacts.
2. GREEN: Update docs and Beads context for the implemented scope.
3. REFACTOR: Keep docs factual and avoid implying PR6 provider rollout has happened.

Validation:

- `bun test test/repo-tooling.test.js`
- `bash scripts/beads-context.sh validate product-suite-ef5`
