# Schema And Domain Ownership

## Purpose
This document is the durable ownership inventory for shared Product Suite domains before contracts extraction begins.

## Ownership Matrix

| Entity | Current Owner | Future Owner | Source-Of-Truth DB | Source-Of-Truth Schema Path | Notes |
| --- | --- | --- | --- | --- | --- |
| `team` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Billing, membership, and invitation ownership stay in the roadmap domain. |
| `workspace` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Workspace lifecycle, planning mode, and module configuration remain roadmap-owned. |
| `thread` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/src/lib/supabase/types.ts` | Canonical workspace conversation threads are represented by roadmap `chat_threads` and thread-scoped `chat_messages`. |
| `meeting` | `meeting-api` | `meeting-api` | `Meeting API Postgres` | `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py` | Meeting records, transcripts, summaries, meeting chat, and processing jobs remain meeting-api owned. |
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

## Non-Goals

- This document does not move runtime schema ownership.
- This document does not unify auth providers.
- This document does not introduce shared contracts.
