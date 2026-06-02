# PR19 Unified Supabase Platform Schema Tasks

Feature: `pr19-unified-supabase-platform-schema`
Date: 2026-06-02

## Task 1: Durable Plan And Ownership Guard

File(s): `docs/research/pr19-unified-supabase-platform-schema.md`, `docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-*.md`, `test/repo-tooling.test.js`

TDD:
1. RED: Add or extend a repo-tooling test that requires PR19 research, design, decisions, and task files.
2. GREEN: Ensure all artifacts exist and link to the PR17 source plan.
3. REFACTOR: Keep assertions path-based and low-noise.

Acceptance: `bun run test:repo-tooling` passes.

## Task 2: Schema Ownership Contract

File(s): `docs/architecture/schema-domain-ownership.md`, `test/domain-inventory.test.js`

TDD:
1. RED: Test requires explicit ownership rows for `platform`, `meeting`, `roadmap`, `agent`, and `realtime`.
2. GREEN: Update the ownership document with current owner, future owner, database, schema path, and PR19 notes.
3. REFACTOR: Keep prior PR3 overlap notes intact.

Acceptance: ownership docs distinguish Neon-current Meeting from Supabase-target module schemas.

## Task 3: Supabase Platform Migration

File(s): `infra/supabase/migrations/<timestamp>_create_platform_schema.sql`

TDD:
1. RED: Add a SQL/static migration test that fails until `platform` schema and core tables exist.
2. GREEN: Create `platform.users`, `platform.workspaces`, `platform.memberships`, `platform.auth_identities`, and `platform.audit_events` with indexes and timestamps.
3. REFACTOR: Keep foreign keys and uniqueness constraints readable.

Acceptance: migration creates the shared platform shape without moving Roadmap or Meeting rows.

## Task 4: Module Schema Reservations

File(s): `infra/supabase/migrations/<timestamp>_create_platform_schema.sql`

TDD:
1. RED: Test fails until `meeting`, `roadmap`, `agent`, and `realtime` schemas are explicitly created or documented.
2. GREEN: Reserve private schemas and add comments describing module owners and PR20 cutover boundaries.
3. REFACTOR: Avoid creating duplicate Meeting tables until PR20.

Acceptance: Supabase has clear schema boundaries before module cutover.

## Task 5: Clerk JWT And RLS Claim Contract

File(s): `packages/contracts/src/auth.js`, `packages/contracts/src/auth.test.ts`, `packages/contracts/src/index.d.ts`, `packages/contracts/contracts/auth-core.json`

TDD:
1. RED: Contract test requires internal platform user/workspace claim names for Supabase RLS.
2. GREEN: Add the claim contract and validation helpers without replacing PR18 Clerk JWT validation.
3. REFACTOR: Keep auth contract exports stable.

Acceptance: RLS mapping does not assume Clerk `sub` equals internal UUID.

## Task 6: Exposure, Grant, And RLS Drift Gate

File(s): `scripts/*`, `test/*`, `infra/supabase/migrations/*`

TDD:
1. RED: Add a static SQL validation that fails if new exposed-schema tables lack RLS/grant intent.
2. GREEN: Implement the guard for PR19 migrations.
3. REFACTOR: Allow private schemas to be intentionally non-exposed.

Acceptance: CI can catch accidental `anon`/`authenticated` exposure for PR19 tables.

## Task 7: Supabase Type Drift Update

File(s): `.github/workflows/roadmap-supabase.yml`, `apps/roadmap-web/src/lib/supabase/types.ts` or new generated type target

TDD:
1. RED: Test/workflow check requires introduced schemas to be included in the type-drift strategy.
2. GREEN: Update generated-type validation or document why private schemas are excluded from browser types.
3. REFACTOR: Keep Roadmap public type generation working.

Acceptance: schema additions cannot silently drift from generated TypeScript expectations.

## Validation Priorities

- `bun run test:repo-tooling`
- `bun run test:contracts`
- SQL/static migration tests added during `/dev`
- `bun run test:prepush`

