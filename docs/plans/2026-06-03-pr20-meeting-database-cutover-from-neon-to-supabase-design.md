# PR20 Meeting Database Cutover From Neon To Supabase Design

Feature: `pr20-meeting-database-cutover-from-neon-to-supabase`
Date: 2026-06-03
Status: dev

## Purpose

Move Meeting API's hosted database target from Neon Postgres to Supabase Postgres without changing Meeting backend ownership. PR20 makes Supabase the canonical hosted Meeting database path, keeps data movement gated by evidence, and leaves Neon only as a temporary rollback target until smoke tests pass.

## Classification

Critical - database migration, hosted runtime configuration, authentication boundary, and rollback safety.

## Success Criteria

- Meeting table schema is represented in the Supabase migration path without inventing names that conflict with the Neon/Alembic baseline.
- Hosted Meeting config can target Supabase Postgres and no longer requires Neon database/auth defaults.
- A preflight command captures row counts and required extension availability before cutover.
- Direct, session-pooler, and transaction-pooler URLs are documented by runtime purpose.
- Meeting create/read smoke tests pass against a Supabase-compatible Postgres connection.
- Rollback instructions keep Neon usable until Supabase smoke tests pass.

## Out Of Scope

- Moving Roadmap tables out of `public`.
- Rewriting all Meeting auth to Clerk-only application behavior.
- Browser access to Meeting private schema tables.
- Billing, module shell, or app-switcher work.
- Removing Neon rollback before production smoke evidence exists.

## Approach Selected

Use a staged cutover:

1. Translate Meeting's checked-in Alembic table history into the canonical Supabase migration surface under `infra/supabase/migrations`.
2. Add a preflight script that reads the current Neon source and Supabase target, captures row counts, verifies required extensions, and fails closed when data movement is unsafe.
3. Update Meeting hosted configuration so `DATABASE_URL` can be Supabase Postgres and hosted auth is not hard-coded to Neon.
4. Add local and CI smoke coverage for Meeting create/read flows against a Supabase-compatible Postgres URL.
5. Document deployment variables, rollback, and connection-string purpose mapping.

## Constraints

- `meeting` is a private Supabase schema reserved by PR19.
- Meeting API remains the write owner for Meeting data.
- `infra/supabase/migrations` is the canonical hosted migration owner after PR20.
- Direct/unpooled URLs are required for migration, backup, dump, and restore operations.
- Transaction pooler URLs must not be used with clients that require prepared statements.
- Existing root checkout is dirty; PR20 implementation work must stay in `.worktrees/pr20-meeting-database-cutover-implementation`.

## Edge Cases

- Production Neon tables contain rows: stop destructive cutover and require backup/restore or logical replication proof.
- Supabase required extensions differ from Neon: block migration until replacement or extension availability is confirmed.
- Alembic and Supabase DDL diverge: prefer checked-in Alembic history plus live row-count evidence, then document any intentional differences.
- Hosted code still assumes Neon auth claims: keep a compatibility mapping until Clerk/platform identity is fully wired.
- Supabase pooler mode changes SQLAlchemy behavior: assign direct/session/transaction URLs explicitly and test the selected runtime path.

## Technical Research

Research is recorded in `docs/research/pr20-meeting-database-cutover-from-neon-to-supabase.md`.

## Workflow Notes

`bd bootstrap` imported the git-tracked Beads JSONL, but `bd create` still failed because the Dolt server reported database `product_suite` was not found. This plan proceeds in git artifacts and the tracker issue must be created once the local Beads/Dolt database is repaired.

## Next

Start `/dev` with Task 1: PR20 plan guard and source-of-truth tests.

