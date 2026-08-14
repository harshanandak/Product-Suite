---
name: db-migrate
description: >
  Change the Product-Suite database schema safely: edit packages/db/src/schema.ts, HAND-AUTHOR
  the migration SQL (`drizzle-kit generate` is FORBIDDEN here — the meta snapshot chain is
  broken, so it emits a wrong or empty diff that looks plausible), add the 0-based journal
  entry, run the parity check, then apply it manually with `bun run --cwd packages/db migrate`
  and RE-FETCH `__drizzle_migrations` to prove it landed. Carries the ledger-offset landmine:
  `__drizzle_migrations.id` is 1-based while `_journal.json` idx is 0-based, so ledger id N
  records journal idx N−1 — 16 rows means 0000–0015 applied, NOT 0016; misreading it nearly
  deleted a live migration record. Use whenever the task touches a table, column, enum, index,
  constraint, or migration: "add a column", "change the schema", "write a migration", "why is
  the migration not applied", "how many migrations have run", "read the drizzle ledger",
  "regenerate the snapshot", "drizzle-kit generate", "migration parity is failing", or any
  edit under packages/db/migrations or packages/db/src/schema.ts. NOT for querying or
  changing application data (that is ordinary app code), NOT for the Forge kernel issue store
  (a different database entirely), and NOT for Supabase migrations under infra/ or
  apps/roadmap-web (this skill covers the Neon platform database in packages/db only).
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# db-migrate

Schema changes in this repo touch six artifacts and one live database. Miss one and the
change is half-built in a way no test catches.

## The landmine: the ledger id is offset from the journal idx

`__drizzle_migrations.id` is **1-based**. `_journal.json` `idx` is **0-based**.

> **Ledger id N records journal idx N−1.**

16 ledger rows means migrations **0000–0015** are applied — **not** 0016. Reading this
wrong once nearly deleted the record for a migration that had in fact applied.

Prove it rather than counting: match each row's `created_at` against the journal entry's
`when`. They are the same timestamp. If they disagree, your mapping is wrong, not the data.

## `drizzle-kit generate` is forbidden

drizzle-kit produces a migration by diffing the newest `meta/NNNN_snapshot.json` against
`schema.ts`. This repo's chain is broken — 9 of 22 entries have no snapshot (0012–0018,
0020, 0021; kernel issue `1c8d790e-68f9-4333-9dcd-0316b69d336b`). Running `generate`
against a stale head snapshot silently emits a diff for the wrong baseline.

So: **hand-author the SQL.** Every migration since 0012 already is.

Do not "fix" the chain by hand-writing snapshot JSON either. Snapshots must be rebuilt in
order from a clean checkout (worktrees cannot resolve `drizzle-orm`). Adding a tag to
`SNAPSHOTLESS_MIGRATION_BASELINE` in `scripts/check-migration-parity.mjs` to silence the
check is the same mistake wearing a hat — that list is a frozen baseline of historical
debt, never a place to put new work.

## Procedure

1. **Edit** `packages/db/src/schema.ts`.
2. **Hand-author** `packages/db/migrations/NNNN_short_name.sql`.
   - Separate statements with `--> statement-breakpoint`.
   - Head-comment **why**, not what — read `0016_memory_ownership_axis.sql` for the house style.
   - Prefer `ADD COLUMN IF NOT EXISTS` / `DO $$ ... EXCEPTION WHEN duplicate_object` so a
     re-run is inert.
   - Additive and row-preserving by default. If it is not, say so out loud and name what
     changes.
3. **Journal**: add the entry to `packages/db/migrations/meta/_journal.json`. `idx` is
   0-based and must stay a contiguous ascending run; `tag` must equal the filename without
   `.sql`.
4. **Test**: extend `packages/db/src/schema.test.ts` (and the catalog contract test if you
   changed the table inventory).
5. **Check**:
   ```bash
   bun run check:migration-parity      # journal ↔ .sql ↔ snapshot chain
   bun run --cwd packages/db test
   ```
6. **Apply — manual, against the live Neon database.** The deploy pipeline has never run
   migrations automatically:
   ```bash
   bun run --cwd packages/db migrate
   ```
7. **Re-fetch and prove it.** Query `__drizzle_migrations`, find *your* tag by its hash and
   timestamp, and say so. A migration that was written but never applied is invisible to
   every check in this repo — only the ledger knows.

If you cannot reach the database, the honest report is "written but unverified — not
applied", not "done".

## Reverse path

Before any write to the live database, state the reverse path in the same message: what
the prior state was and how to get back to it. Additive migrations reverse by dropping
what you added; anything that rewrites rows needs its inverse written before you run it.

## Related

- `f354bdc2-55f3-40fe-9ae5-2c22985d7b18` — index the whole migration surface so this is
  readable in one place
- `1c8d790e-68f9-4333-9dcd-0316b69d336b` — regenerate the 9 missing snapshots
- Root `AGENTS.md` §7 (hit every surface) and §9 (runbook)
