# Meeting Supabase Cutover — Historical Archive

> **Status: historical, non-authoritative.** This document records the former
> PR20 Supabase cutover proposal and its later reversal. It is retained for
> provenance and is not an operator runbook.

The supported Meeting database authority is Neon Postgres, using the Drizzle
migrations under `packages/db/migrations`. No supported deployment reads from,
writes to, or migrates data into a Supabase database. The repository contains
no supported Supabase cutover command or workflow.

The old cutover scripts and CI workflows were retired because they could point
at a live database and inject provider credentials into automation. The old
Roadmap application is separately classified as unsupported/archived; its
source and historical Supabase migrations remain discoverable for recovery
work, but they are not a supported production surface.

## Historical evidence boundary

- `infra/supabase/migrations/**` and `apps/roadmap-web/supabase/migrations/**`
  are immutable historical artifacts.
- Their canonical LF hashes (and observed legacy CRLF hashes where applicable)
  are recorded by `docs/history/database-migrations/manifest.json`.
- The manifest is validation-only. It is not a migration journal and is never
  consulted to decide pending Neon migrations.
- No data copy, dump/restore, replication, row deletion, or schema rewrite is
  authorized by this archive.

## Operational handoff

Use the current Neon authority contract and guarded Drizzle runner for any
future database work. Before a human removes repository Supabase secrets or
archives an external project, prove that no supported consumer remains and
record that evidence in the Forge issue. Repository code never deletes those
secrets automatically.

The original PR19/PR20 research, plans, and migration files remain historical
records. They must not be edited to make the prior direction appear never to
have existed.
