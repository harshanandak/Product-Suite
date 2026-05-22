# PR17 Platform Auth And Data Consolidation Tasks

Feature: `pr17-platform-auth-data-consolidation`
Beads: `product-suite-do6`
Date: 2026-05-21
Status: ready-for-dev

## Task 1: Durable Plan State

Goal: make the building-blocks plan accurately reflect the completed PR16 state and the new PR17+ sequence.

TDD/checks:
- Update repo-tooling tests before or with the plan change.
- Assert PR16 is merged and verified.
- Assert PR17 is active on `feat/pr17-platform-auth-data-consolidation`.
- Assert PR17 design artifacts are discoverable from the durable plan.

Validation:
- `bun run test:repo-tooling`

## Task 2: Platform Topology Decision

Goal: document the single-domain platform shell decision.

Required decisions:
- Use one public product shell instead of separate public websites.
- Reserve routes for `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings`.
- Keep modules independently owned under the shell.
- Make Meeting a first-class Product Suite module.

Edge cases:
- route collisions
- one module failing the whole shell
- auth redirects looping between modules
- oversized bundles after combining surfaces

Mitigations:
- module registry owns route prefixes
- route-level error boundaries
- central auth guard
- lazy-loaded module entrypoints

## Task 3: Auth Provider Decision

Goal: document Clerk as canonical user-facing auth while keeping Supabase as database infrastructure.

Required decisions:
- Clerk owns login, sessions, users, organizations, invitations, and user management UI.
- Supabase Auth is not the primary user auth provider.
- Internal tables store mapped users/workspaces; domain records use internal IDs.
- Backend services validate Clerk JWTs through shared helpers.

Edge cases:
- webhook replay
- user signs in before webhook sync
- deleted Clerk org with existing database rows
- stale JWT membership claims
- preview deployments using the wrong Clerk instance
- auth redirect loops or lost post-login intent
- mismatched Clerk JWT issuer, audience, template, subject, or organization claims

Mitigations:
- idempotent webhook handlers
- lazy first-request sync fallback
- soft-disable workspaces before hard delete
- server-side membership checks for sensitive writes
- fail-closed env validation
- one callback owner with signed `return_to`, allowed-prefix whitelist, and redirect-loop tests
- explicit Clerk-to-Supabase JWT contract before browser Supabase access

## Task 4: Unified Supabase Database Decision

Goal: document one Supabase Postgres project as the physical platform database.

Required decisions:
- Use one Supabase project for the platform.
- Keep logical ownership by schema/table group.
- Do not use multiple databases per module while validating product-market fit.
- Treat current production user/project data as empty, but verify before cutover.

Proposed ownership:
- `platform`: users, workspaces, memberships, audit events
- `meeting`: meetings, transcripts, summaries, participants
- `roadmap`: work items, timeline items, documents, feedback
- `agent`: runs, tasks, memory refs
- `realtime`: documents, sessions, presence

Edge cases:
- Supabase Data API exposes more than intended
- Roadmap public-schema assumptions break schema moves
- Meeting Alembic and Supabase migrations diverge
- connection pooling differs between Neon and Supabase
- data appears before cutover
- existing `anon` or `authenticated` grants expose tables through PostgREST
- RLS policies compare Clerk `sub` to the wrong internal user identifier
- generated Supabase types drift after schema changes
- required Postgres extensions differ between Neon, local Postgres, and Supabase

Mitigations:
- private schemas where possible
- RLS on exposed schemas
- compatibility views where needed
- one canonical migration path after Meeting cutover
- row-count preflight before destructive decisions
- revoke default privileges and fail CI on unexpected exposed grants
- SQL tests for mismatched user/workspace/org claims
- run local Supabase reset and type generation for every schema PR
- backup/restore and extension availability proof before Meeting cutover

## Task 5: Follow-Up PR Breakdown

Goal: keep implementation slices reviewable.

Required PRs:
- PR18 Clerk Auth Foundation
- PR19 Unified Supabase Platform Schema
- PR20 Meeting Database Cutover From Neon To Supabase
- PR21 Single Domain Platform Shell
- PR22 Platform Permissions And Access Hardening
- PR23 Observability Billing Readiness And Conversion Analytics

Validation:
- Each future PR must include focused tests, env contract checks, and rollback notes.
- Each future PR task list must explicitly follow TDD phases: RED (introduce failing test), GREEN (minimal implementation), and REFACTOR (cleanup with tests still green).
- Commits must be blocked when source files change without corresponding test file updates through the pre-commit source-test coupling gate.
- Database/auth PRs must include failure-mode tests.
- Shell PRs must include route and module-registry tests.
- PR18 must define auth redirect and event identity contracts.
- PR19 must define Clerk JWT/RLS mapping, migration ownership, exposed-schema policy, and generated-type drift gates.
- PR20 must include direct/session/pooler URL handling, backup proof, extension checks, and row-count proof.
- PR21 must include a generated route ownership matrix, duplicate-route guard, compatibility redirects, and per-module bundle budgets.
- PR23 can expand analytics sinks, but telemetry field names must already exist before shell rollout.

## Task 6: Beads And Stage Context

Goal: make the planning issue resumable.

Required updates:
- Add issue description for `product-suite-do6`.
- Mark issue in progress during planning.
- Record plan artifacts in the issue description or comments.

Exit criteria:
- The design doc and task list exist.
- Durable plan points to PR17 artifacts.
- Repo-tooling guard passes.
- Worktree branch is ready for review or ship.

## Task 7: Evaluator Hardening Pass

Goal: ensure the plan captures adversarial risks found by evaluator agents and current Clerk/Supabase docs.

Required updates:
- Add a Clerk/JWT/RLS contract gate.
- Add webhook signature, idempotency, retry, replay, and lazy reconciliation requirements.
- Add Supabase exposed-schema, grant, and RLS audit gates.
- Add migration-owner, schema-qualified table, generated-type, and Alembic retirement decisions.
- Add connection pooling, backup/restore, and extension preflight gates.
- Add route ownership, auth redirect, module isolation, and bundle budget gates.
- Move telemetry identity and conversion event contracts earlier than PR23.

Validation:
- `bun run test:repo-tooling`
- `bun run check:source-test`
