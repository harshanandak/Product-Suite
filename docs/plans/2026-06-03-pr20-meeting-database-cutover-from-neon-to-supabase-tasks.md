# PR20 Meeting Database Cutover From Neon To Supabase Tasks

Feature: `pr20-meeting-database-cutover-from-neon-to-supabase`
Date: 2026-06-03

## Task 1: Durable Plan And Cutover Guard

File(s): `docs/research/pr20-meeting-database-cutover-from-neon-to-supabase.md`, `docs/plans/2026-06-03-pr20-meeting-database-cutover-from-neon-to-supabase-*.md`, repo tooling tests

TDD:
1. RED: Add or extend a repo-tooling test that requires PR20 research, design, decisions, and task files.
2. GREEN: Ensure all artifacts exist and link to PR17, PR19, and the architecture ownership document.
3. REFACTOR: Keep assertions path-based and low-noise.

Acceptance: plan artifacts are enforced and the next task can start without re-reading old PRs.

## Task 2: Meeting Schema Migration Into Supabase

File(s): `infra/supabase/migrations/*`, `apps/meeting-api/backend/alembic/versions/*`, SQL/static migration tests

TDD:
1. RED: Add a static migration test that fails until Meeting-owned tables are represented in the Supabase migration path.
2. GREEN: Port or reconcile the Meeting Alembic baseline into the `meeting` Supabase schema.
3. REFACTOR: Keep Alembic retirement/read-only status explicit.

Acceptance: Supabase has a committed Meeting schema target and no duplicate migration owner is ambiguous.

## Task 3: Cutover Preflight

File(s): `scripts/*`, `docs/deployment/*`, tests for preflight SQL generation

TDD:
1. RED: Test fails until every Meeting source table is included in row-count and extension preflight checks.
2. GREEN: Add a preflight command that captures Neon row counts, Supabase target readiness, and required extensions.
3. REFACTOR: Make the command fail closed when data exists without an approved migration route.

Acceptance: PR20 can prove whether cutover is safe before changing hosted runtime variables.

## Task 4: Meeting Runtime Config

File(s): `apps/meeting-api/backend/config.py`, `apps/meeting-api/backend/.env.example`, `apps/meeting-api/tests/backend/test_config.py`

TDD:
1. RED: Config tests fail while hosted Meeting requires `AUTH_PROVIDER=neon` or defaults `DATABASE_PROVIDER` to Neon.
2. GREEN: Allow Supabase/Postgres hosted database configuration and keep auth compatibility explicit.
3. REFACTOR: Keep OSS/local defaults stable.

Acceptance: hosted Meeting can run with Supabase Postgres without forcing Neon database/auth defaults.

## Task 5: Connection Purpose Documentation

File(s): `apps/meeting-api/docs/deployment/*`, `docs/deployment/*`, docs alignment tests

TDD:
1. RED: Docs test fails until direct, session-pooler, and transaction-pooler URL purposes are documented.
2. GREEN: Document which URL is used for migrations/backups, persistent hosted runtime, and transient/serverless contexts.
3. REFACTOR: Avoid embedding secrets or project passwords.

Acceptance: operators can choose the right Supabase connection string without guessing.

## Task 6: Meeting Create/Read Smoke Coverage

File(s): `apps/meeting-api/tests/backend/*`, `scripts/meeting-api-validation.mjs`, CI or validation scripts

TDD:
1. RED: Add a smoke test that fails without a Supabase-compatible Postgres URL.
2. GREEN: Exercise Meeting create/read flow through the repository/service layer against the configured database.
3. REFACTOR: Keep destructive test data isolated and cleanable.

Acceptance: Meeting create/read flows pass against Supabase-compatible Postgres before Neon is demoted to rollback.

## Task 7: Rollback And Deployment Handoff

File(s): `docs/deployment/*`, `apps/meeting-api/docs/deployment/*`, PR handoff notes

TDD:
1. RED: Docs test fails until rollback steps mention the Neon fallback and cutover verification sequence.
2. GREEN: Document deployment variables, smoke order, rollback trigger, and Neon retirement criteria.
3. REFACTOR: Keep rollback steps concrete and reversible.

Acceptance: operators can revert Meeting API to Neon until Supabase smoke tests pass.

## Validation Priorities

- `bun run test:repo-tooling`
- `bun run test:contracts`
- `bun run test:prepush`
- Meeting backend tests under `apps/meeting-api/tests/backend`
- Supabase migration dry-run against the linked project before remote apply

