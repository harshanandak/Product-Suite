# Schema And Domain Ownership

## Purpose
This document is the durable ownership inventory for shared Product Suite domains before contracts extraction begins.

## Ownership Matrix

| Entity | Current Owner | Future Owner | Source-Of-Truth DB | Source-Of-Truth Schema Path | Notes |
| --- | --- | --- | --- | --- | --- |
| `team` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Billing, membership, and invitation ownership stay in the roadmap domain. |
| `workspace` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Workspace lifecycle, planning mode, and module configuration remain roadmap-owned. |
| `thread` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/src/lib/supabase/types.ts` | Canonical workspace conversation threads are represented by roadmap `chat_threads` and thread-scoped `chat_messages`. |
| `task` | `roadmap-web` | `roadmap-web` | `Supabase Postgres` | `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` | Product work tracking stays in roadmap `features`, `timeline_items`, and related dependency tables. |

## Roadmap Domain-Local Scope

Roadmap is the canonical source of truth for the team and workspace planning model:
- team membership and billing
- workspace lifecycle and configuration
- workspace conversation threads
- feature and timeline task planning

## Overlap Notes

This section records places where names overlap across roadmap and meeting surfaces so later PRs do not infer false unification.

## Non-Goals

- This document does not move runtime schema ownership.
- This document does not unify auth providers.
- This document does not introduce shared contracts.
