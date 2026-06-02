# PR19 Unified Supabase Platform Schema Decisions

Date: 2026-06-02
Feature: `pr19-unified-supabase-platform-schema`

## Decisions

1. Neon is the current Meeting schema source for PR19 planning.
   - Evidence: Neon CLI live introspection found `neondb`, schemas `neon_auth` and `public`, and 29 tables matching Meeting/Alembic ownership.

2. Supabase migrations under `infra/supabase/migrations` become the canonical future schema owner.
   - Reason: `.github/workflows/roadmap-supabase.yml` already validates this path for migration history and generated types.

3. PR19 creates platform shape and boundaries, not Meeting cutover.
   - Reason: PR20 is the explicit Meeting Database Cutover From Neon To Supabase slice.

4. New platform/module tables should use private schemas by default.
   - Reason: Supabase Data API exposure and default grants make `public` risky for internal platform tables.

5. Existing Roadmap public tables stay public in PR19.
   - Reason: current Roadmap code and generated types are public-schema based; moving them requires a later compatibility PR.

## Open Follow-Up For Dev

- Beads/Dolt issue creation is currently blocked by `database "product_suite" not found` on the local Dolt server. `bd bootstrap --dry-run` selected the checked-in JSONL import path, but `bd bootstrap` then reported the database already exists while `bd list` and `forge plan` still failed. Durable plan files are the source of truth until Beads is repaired.
