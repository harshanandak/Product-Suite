# PR20 Meeting Database Cutover From Neon To Supabase Research

Date: 2026-06-03
Branch: `feat/pr20-meeting-database-cutover-from-neon-to-supabase`

## Scope

PR20 moves Meeting API database connectivity from Neon Postgres to Supabase Postgres while preserving Meeting backend ownership. The cutover must reconcile Meeting Alembic history with `infra/supabase/migrations`, prove row-count and backup safety before data movement, and remove the hosted runtime requirement that forces Neon as the database and auth provider.

## Existing plan inputs

- `docs/plans/building-blocks-transformation-pr-plan.md` defines PR20 as `Meeting Database Cutover From Neon To Supabase`.
- `docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md` says PR20 must point Meeting API at Supabase Postgres, separate direct/session/transaction pooler URLs by runtime purpose, and add create/read smoke tests.
- `docs/architecture/schema-domain-ownership.md` says Meeting remains on Neon until PR20 and that `infra/supabase/migrations` is the canonical migration owner for the unified platform shape.
- `docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-design.md` keeps live row movement and Meeting `DATABASE_URL` changes out of PR19.

## Checked-in Meeting database baseline

Canonical Meeting schema history is currently split across:

- `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py`
- `apps/meeting-api/backend/alembic/versions/0002_summary_first_memory.py`
- `apps/meeting-api/backend/alembic/versions/0003_meeting_intelligence_hardening.py`
- `apps/meeting-api/backend/alembic/versions/0004_auth_provider_redesign.py`
- `apps/meeting-api/backend/alembic/versions/0005_remove_workos_session_id.py`
- `apps/meeting-api/backend/migrations/0001_initial.sql`
- `apps/meeting-api/backend/migrations/0002_users_and_ownership.sql`

PR20 should not create a third schema history. The implementation needs one canonical Supabase migration path for hosted Meeting after cutover, while Alembic remains either read-only history or local/OSS-only migration tooling.

## Current runtime constraints

- `apps/meeting-api/backend/.env.example` currently documents `AUTH_PROVIDER=neon`, `CANONICAL_AUTH_PROVIDER=neon`, and Neon JWKS/issuer defaults.
- `apps/meeting-api/backend/config.py` allows only `local` and `neon` auth providers, defaults hosted `database_provider` to `neon`, and rejects hosted deployments unless `AUTH_PROVIDER=neon`.
- PR18/PR19 established Clerk and platform identity contracts, but Meeting writes still need an explicit mapping path before hosted Neon auth can be retired.

## External guidance

- Supabase connection docs distinguish direct connections, pooler session mode, and pooler transaction mode. Direct connections are preferred for persistent servers where IPv6 is available; session pooler is an IPv4-compatible alternative for persistent clients; transaction pooler is for transient/serverless clients and does not support prepared statements. Source: https://supabase.com/docs/reference/postgres/connection-strings
- Supabase migration docs say schema changes should go through migration files, local migrations should be tested before commit, and one person or CI should push remote migrations in timestamp order. Source: https://supabase.com/docs/guides/deployment/database-migrations
- Supabase CLI docs say `supabase db push --dry-run` previews remote migration changes and `--db-url` can target a specific database connection. Source: https://supabase.com/docs/reference/cli/supabase-db-push
- Neon migration docs recommend unpooled connection strings for `pg_dump`/`pg_restore`; pooled connections should be avoided for dump/restore workflows. Source: https://neon.com/docs/import/migrate-from-neon
- Neon logical replication docs note that replicating from Neon requires attention to replication slots, active subscribers, and branch restore behavior. For this PR, row-count evidence should decide whether dump/restore is enough or whether a later zero-downtime replication plan is needed. Source: https://neon.com/docs/guides/logical-replication-neon

## Safety requirements

- Capture row counts for every Meeting-owned Neon table before any destructive action.
- Prove Supabase required extensions exist before applying Meeting schema migrations.
- Use direct/unpooled URLs for migration, backup, dump, and restore operations.
- Use the correct pooled URL mode for hosted runtime based on deployment shape and client behavior.
- Keep Neon as rollback target until Meeting create/read smoke tests pass against Supabase.
- Do not expose Meeting private tables to browser roles unless a later PR intentionally designs RLS and grants.

## TDD scenarios

1. Static planning/tooling test fails until PR20 research, design, tasks, and decisions files exist.
2. Migration test fails until Meeting table DDL is represented in `infra/supabase/migrations` under the `meeting` schema or a documented canonical equivalent.
3. Config test fails until hosted Meeting no longer requires `AUTH_PROVIDER=neon` or `DATABASE_PROVIDER=neon`.
4. Preflight test fails until row-count SQL covers all Meeting-owned source tables and refuses unsafe cutover when data exists without an approved migration path.
5. Smoke test fails until Meeting create/read flows can run against a Supabase-compatible Postgres connection.
6. Documentation test fails until direct, session-pooler, and transaction-pooler URLs are assigned to concrete runtime/migration purposes.

