# PR19 Unified Supabase Platform Schema Research

Date: 2026-06-02
Branch: `feat/pr19-unified-supabase-platform-schema`

## Scope

PR19 creates the unified database shape before PR20 moves Meeting runtime connectivity off Neon. The target is a committed Supabase migration surface under `infra/supabase`, while the existing Meeting schema baseline must be read from Neon and the checked-in Meeting Alembic migrations.

## Existing plan inputs

- `docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md` defines PR19 as the schema ownership, Clerk JWT/RLS, exposed-schema, migration owner, and drift-gate PR.
- `docs/plans/building-blocks-transformation-pr-plan.md` says PR19 must make Supabase ready to hold platform-shared tables and module-owned tables with clear access boundaries.
- PR18 already produced Clerk environment, redirect, JWT payload, identity sync, and event identity contracts in `packages/contracts/src/auth.js`.

## Live Neon baseline

Neon CLI authentication was verified for `harshananda57@gmail.com`. The current Neon context resolved:

- Project: `cool-glitter-50094249`
- Branch: `production` / `br-long-mud-a1hgo48a`
- Database: `neondb`
- Postgres: `17.10`
- Schemas: `neon_auth`, `public`
- Tables: 29

Live Neon tables:

- `neon_auth`: `account`, `invitation`, `jwks`, `member`, `organization`, `project_config`, `session`, `user`, `verification`
- `public`: `action_items`, `agent_invocations`, `agent_responses`, `alembic_version`, `audio_assets`, `chapter_summaries`, `chat_messages`, `decisions`, `jobs`, `meeting_links`, `meeting_state`, `meetings`, `open_questions`, `organization_invitations`, `organization_memberships`, `summaries`, `tenants`, `transcript_segments`, `user_auth_identities`, `users`

Implication: PR19 should not invent Meeting table names. It should stage the target Supabase shape from Neon public Meeting tables, but keep PR20 responsible for data cutover and runtime connection changes.

## Checked-in Meeting schema baseline

Canonical checked-in Meeting migrations are under `apps/meeting-api/backend/alembic/versions`.

- `0001_multi_user_jobs.py` creates `users`, `meetings`, `transcript_segments`, `summaries`, `chat_messages`, and `jobs`.
- `0002_summary_first_memory.py` adds `tenants`, meeting memory tables, `vector`, job payload/result/idempotency fields, and Meeting intelligence tables.
- `0003_meeting_intelligence_hardening.py` adds confidence, promotion, and source-window metadata.
- `0004_auth_provider_redesign.py` adds `user_auth_identities`, `organization_memberships`, and `organization_invitations`.
- `0005_remove_workos_session_id.py` removes the legacy WorkOS session column.

## Checked-in Supabase baseline

- Supabase config is under `infra/supabase/config.toml`.
- Local Data API exposes `public` and `graphql_public`.
- `infra/supabase/migrations` is the canonical Supabase migration folder used by `.github/workflows/roadmap-supabase.yml`.
- The live workflow currently generates types only for `--schema public`, so PR19 must update the drift/type gate if private module schemas are introduced.
- Existing Roadmap migrations contain many `auth.uid()` policies. PR19 must not globally rewrite Roadmap RLS until the Clerk JWT bridge is implemented and tested.

## Current external guidance

Supabase API security docs state that grants and RLS are separate layers: grants decide whether roles can reach tables/functions, while RLS decides which rows are visible or mutable. They also warn that existing projects may auto-grant privileges in `public`, and recommend bundling grants with RLS setup in the same migration. Source: https://supabase.com/docs/guides/api/securing-your-api

Supabase RLS docs state that RLS must be enabled for exposed schemas, `auth.uid()` returns null without a valid Supabase-authenticated user, views bypass RLS unless `security_invoker = true` on Postgres 15+, and `raw_user_meta_data` must not be used for authorization. Source: https://supabase.com/docs/guides/database/postgres/row-level-security

Neon custom auth docs describe passing provider JWTs to the Neon Data API, validating them via JWKS, and enforcing RLS based on JWT identity. For Clerk, Neon documents the Clerk JWKS URL pattern and the dedicated Clerk Neon JWT template. Source: https://neon.com/docs/data-api/custom-authentication-providers

## Design constraints

- Treat Neon as the current physical Meeting schema source.
- Treat Supabase SQL migrations as the future canonical schema owner.
- Keep Meeting runtime cutover, row movement, and `DATABASE_URL` changes out of PR19.
- Keep new module tables in private schemas unless intentionally exposed.
- Do not depend on `auth.uid()` for Clerk users unless the token subject is intentionally mapped to the internal platform UUID.
- Do not expose service-role or secret keys to browser code.

## TDD scenarios

1. Plan/schema ownership test fails until PR19 docs define `platform`, `meeting`, `roadmap`, `agent`, and `realtime` ownership.
2. Migration text test fails until platform identity/workspace tables exist in a new Supabase migration under private schemas with grants/RLS handled explicitly.
3. Drift gate test fails until Supabase type generation covers every schema PR19 introduces or documents why a schema is intentionally not generated.
4. Security test fails if a new table in an exposed schema lacks RLS or if `anon`/`authenticated` grants are present without an allowlist.
5. Contract test fails unless Clerk JWT/RLS claim names are defined for internal user and workspace identity.

