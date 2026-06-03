# PR20 Meeting Database Cutover From Neon To Supabase Decisions

Feature: `pr20-meeting-database-cutover-from-neon-to-supabase`
Date: 2026-06-03

## Decisions

1. PR20 is a critical database cutover PR.
   - Reason: it changes hosted database ownership and can affect production data safety.

2. Supabase migrations become the canonical hosted Meeting schema owner after PR20.
   - Reason: PR19 established `infra/supabase/migrations` as the unified platform migration path.

3. Neon remains rollback-only until Supabase smoke tests pass.
   - Reason: PR20 must not remove the last known working hosted database target before proving Meeting create/read flows.

4. Data movement is gated by preflight evidence.
   - Reason: prior plans assumed production data may be empty, but PR20 must verify row counts before relying on that assumption.

5. Beads issue creation is temporarily blocked.
   - Reason: `bd bootstrap` imported `.beads/issues.jsonl`, but `bd create` still failed because the Dolt server reported database `product_suite` was not found.

