# Schema And Domain Ownership

## Purpose
This document is the durable ownership inventory for shared Product Suite domains before contracts extraction begins.

## Ownership Matrix

| Entity | Current Owner | Future Owner | Source-Of-Truth DB | Source-Of-Truth Schema Path | Notes |
| --- | --- | --- | --- | --- | --- |
| `team` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Billing, membership, and invitation ownership stay in the roadmap domain. |
| `workspace` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Workspace lifecycle, planning mode, and module configuration remain roadmap-owned. |
| `thread` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `infra/supabase/migrations/20251208100000_create_chat_threads_tables.sql` | Canonical workspace conversation threads are represented by roadmap `chat_threads` and thread-scoped `chat_messages`. |
| `meeting` | `meeting-api` | `meeting-api` | `Meeting API Postgres` | `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py` | Meeting records, transcripts, summaries, meeting chat, and processing jobs remain meeting-api owned. |
| `artifact` | `split by artifact type` | `split by artifact type` | `Supabase Postgres` and `Meeting API Postgres` | `apps/roadmap-web/src/lib/supabase/types.ts` and `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py` | Planning and canvas artifacts remain roadmap-owned, while transcript, summary, and processing artifacts remain meeting-api owned. |
| `task` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Product work tracking stays in roadmap `features`, `timeline_items`, and related dependency tables. |

## Roadmap Domain-Local Scope

Roadmap is the canonical source of truth for the team and workspace planning model:
- team membership and billing
- workspace lifecycle and configuration
- workspace conversation threads
- feature and timeline task planning

## Meeting Domain-Local Scope

Meeting transcript, summary, and processing job artifacts stay in the meeting-api domain.

Meeting API remains the canonical source of truth for:
- meeting records
- transcript segments
- generated summaries
- meeting-scoped chat history
- long-running meeting jobs

## Migration Drift

Meeting API currently has two checked-in migration truth sources that are not equivalent:
- `apps/meeting-api/backend/migrations/0001_initial.sql`
  - older raw SQL baseline with `meetings`, `transcript_segments`, `summaries`, and `chat_messages`
- `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py`
  - current Alembic baseline that adds `users`, `jobs`, and `owner_user_id` ownership fields

For PR3, the canonical source-of-truth schema path for meeting ownership is the Alembic migration file, while the older raw SQL file must remain documented as migration-path drift.

## Overlap Notes

This section records places where names overlap across roadmap and meeting surfaces so later PRs do not infer false unification.

### `users`

Roadmap `users` are part of the team and workspace membership model.

Meeting-api `users` are part of the meeting ownership and job execution model.

PR4 and PR5 can normalize identity claims later, but PR3 does not treat these tables as one shared schema owner.

### Chat semantics

Roadmap `chat_threads` and roadmap `chat_messages` represent workspace conversation state.

Meeting-api `chat_messages` represent meeting-scoped assistant and transcript-adjacent conversation state.

The shared noun is similar, but the resource boundary is different:
- roadmap chat is workspace-thread scoped
- meeting chat is meeting scoped

### Artifact split

Planning and canvas artifacts stay in roadmap, while transcript and summary artifacts stay in meeting-api.

Examples:
- roadmap-owned artifacts:
  - `blocksuite_documents`
  - workspace planning records
  - dashboard and review artifacts
- meeting-api-owned artifacts:
  - transcript segments
  - summaries
  - meeting processing jobs

## Shared-Contract Boundary

PR4 can only extract shared wire contracts that respect the documented ownership split:
- roadmap remains authoritative for workspace and planning entities
- meeting-api remains authoritative for meeting entities
- overlapping names do not automatically become shared contracts

If a later PR needs one shared abstraction, it must sit above these domain owners instead of replacing them implicitly.

## Non-Goals

- This document does not move runtime schema ownership.
- This document does not unify auth providers.
- This document does not introduce shared contracts.
