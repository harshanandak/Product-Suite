# PR19 Unified Supabase Platform Schema Design

Feature: `pr19-unified-supabase-platform-schema`
Date: 2026-06-02
Status: plan

## Purpose

Create the unified Product Suite database shape before Meeting moves off Neon. PR19 establishes Supabase as the committed schema/migration surface while using Neon as the verified source for the current Meeting tables.

## Success Criteria

- `platform`, `meeting`, `roadmap`, `agent`, and `realtime` ownership are documented with schema boundaries.
- A Supabase migration creates the platform-shared identity/workspace base without moving live data.
- Clerk JWT/RLS claim names are explicit and aligned with PR18 auth contracts.
- New private schemas are not accidentally exposed through Supabase Data API grants.
- Validation catches schema/type drift for introduced schemas.

## Out Of Scope

- Moving Meeting runtime `DATABASE_URL` from Neon to Supabase.
- Copying production rows from Neon.
- Rewriting all Roadmap `auth.uid()` policies.
- Browser Supabase access to new private schemas.
- Billing implementation.

## Approach Selected

Use a schema-first Supabase migration with private module schemas and a small shared `platform` schema:

- `platform`: internal users, workspaces, memberships, auth identities, audit events, and event identity fields.
- `meeting`: reserved module schema shaped from Neon Meeting tables, but PR20 performs actual cutover.
- `roadmap`: ownership marker and compatibility decision only; existing Roadmap public tables stay in `public` during PR19.
- `agent`: reserved for agent invocation/runtime ownership.
- `realtime`: reserved for collaboration transport state.

This keeps PR19 mergeable without live data movement and gives PR20 a concrete migration owner and schema contract.

## Constraints

- Neon live schema is authoritative for current Meeting table names.
- `infra/supabase/migrations` is the canonical future migration path.
- Private schemas must stay outside the Data API exposure list unless explicitly opened.
- Any exposed table must have RLS and matching grants in the same migration.
- Clerk JWT claims must carry internal platform identity; RLS must not assume `auth.uid()` equals Clerk `sub`.

## Edge Cases

- Supabase `public` default grants expose tables: revoke or avoid `public` for new platform/module tables.
- Existing Roadmap code expects `public`: do not move Roadmap tables in PR19.
- Generated types drift: update type generation to include introduced schemas or explicitly document private-schema exclusion.
- Neon branch is archived: live introspection worked, but PR20 needs a fresh connection/runbook check before data movement.
- JWT claims become stale: backend-mediated writes remain the default for sensitive membership changes.

## Ambiguity Policy

Use the `/dev` 7-dimension decision gate. If confidence is at least 80%, proceed and document the decision in `docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-decisions.md`. Below 80%, stop and ask.

## Technical Research

Research is recorded in `docs/research/pr19-unified-supabase-platform-schema.md`.

## Next

Start `/dev` with Task 1: durable PR19 plan state and schema ownership tests.

