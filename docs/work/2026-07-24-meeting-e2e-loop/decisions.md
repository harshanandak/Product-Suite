# Decisions log — meeting → board end-to-end loop

The `/dev` decisions log for [`tasks.md`](./tasks.md). One entry per spec gap or
deviation, recorded at the moment the choice was made.

---

## D1 — Migration number shifted from `0016` to `0015` (Task B.1)

**Context.** `tasks.md` assigns `0015_meeting_schema.sql` to Task A.1 and
`0016_meeting_promotions.sql` to Task B.1. B.1 is explicitly *parallel with* A.1
and was implemented first; A.1 is not built.

**Decision.** B.1 takes the next free number: `packages/db/migrations/0015_meeting_promotions.sql`,
journal `idx: 15`. A.1's meeting-schema migration takes `0016` when it lands.

**Why.** Drizzle's journal must be a contiguous `0..N` sequence — `check-migration-parity.mjs`
fails on a gap. Reserving `0015` for an unwritten migration would leave the journal
non-contiguous and the parity gate red until A.1 lands. Migration numbers are ordering,
not identity; the two migrations are independent, so either order applies cleanly.

**Consequence for A.1.** Author the meeting schema as `0016_meeting_schema.sql`, `idx: 16`.

---

## D2 — No regenerated snapshot chain for `0015` (Task B.1)

**Context.** `tasks.md` says the migration comes "+ journal/snapshot", and the plan
warns the snapshot chain must be regenerated from a clean primary checkout because a
worktree cannot resolve `drizzle-orm`.

**Decision.** The migration SQL and the journal entry are hand-authored; **no**
`meta/00NN_snapshot.json` was added.

**Why.** `packages/db/migrations/meta/` holds snapshots for `0000`–`0011` only.
`0012`, `0013` and `0014` each shipped hand-authored SQL + a journal entry and no
snapshot — their headers say so explicitly ("Hand-authored (drizzle-kit generate
unavailable in the worktree)"). The snapshot chain is already ungated and stale;
`scripts/check-migration-parity.mjs` compares the journal against the `.sql` files
and does not read snapshots at all. Adding a lone `0015` snapshot on top of a chain
that stops at `0011` would be a fabricated link, not a regenerated chain.

**Filed as follow-up, not fixed here.** Regenerating `0012`–`0015` from a clean
primary checkout is a repo-wide chore outside this task's payload.

**Verification.** `bun run check:migration-parity` passes; `bun run --cwd packages/db test`
(12 tests) and `typecheck` pass.

---

## D3 — Task C.1's `Sidebar.test.tsx` edit was a no-op (Task C.1)

`tasks.md` lists `apps/platform-web/src/shell/Sidebar.test.tsx` among C.1's files
("assertions referencing removed rows"). That file contains no reference to any
meeting nav row — nothing to remove. The removed-row assertions live in
`boards.test.ts`, which was updated. Left untouched rather than edited for the
sake of matching the file list.

---

## D4 — A.2 needed a `runQuery` seam, slightly beyond "nothing else" (Task A.2)

**Context.** A.2's GREEN scope is "parameterise both `schemaName` arguments … and
thread them from env/CLI. Nothing else." But its RED tests 1 and 2 assert that
`runPreflight` *passes* the schema names to the SQL builders, and `runPreflight`
reached psql through a module-private `runPsqlJson` with no injection point —
unobservable without a live database (and `psql` is not on this box).

**Decision.** Added one parameter, `runQuery = runPsqlJson`, defaulting to the
real implementation. Tests pass a recorder; nothing else changes.

**Why.** The alternative was to leave RED tests 1 and 2 unwritten, i.e. ship the
parameterisation untested — which the spec explicitly asks for. One defaulted
parameter is the smallest seam that makes the specified assertions possible.

---

## D5 — The preflight report records the schemas; provider labels left alone (Task A.2)

**Context.** `runPreflight` builds a report with `source.provider: "neon"` and
`target.provider: "supabase"` hardcoded, and the URL parameters are named
`neonDatabaseUrl` / `supabaseDatabaseUrl`. In the reverse direction those names
are backwards: the "neon" slot carries the Supabase source URL.

**Decision.** Added `source.schema` / `target.schema` to the report (with a test).
Did **not** rename the provider labels or the URL parameters.

**Why the addition.** A.4 archives this report as cutover evidence. Without the
schemas, an archived report cannot say which direction it covers — the reversal
would otherwise make the evidence ambiguous.

**Why not the rename.** Renaming the parameters is a caller-visible change across
A.4's runbook commands and the CLI env contract, outside A.2's stated scope. The
runbook's new reverse section states plainly that `NEON_DATABASE_URL` /
`SUPABASE_DATABASE_URL` are the **source** and **target** slots regardless of
vendor. **The `provider` labels in the report remain forward-direction-named and
are misleading in the reverse direction — a follow-up, not a fix smuggled in here.**

---

## D6 — A.3's "test a test" seam (Task A.3)

**Context.** A.3's RED tests 1 and 2 are properties of the smoke test *file*
(which env var gates its skip, whether it pins a provider). The smoke only runs
against a live Postgres, so those properties are unobservable in CI.

**Decision.** Factored the two decisions into module-level functions in the
renamed smoke —`resolve_smoke_database_url(env)` and
`build_settings_stub(url, provider)` — and put the assertions in a sibling
`test_target_db_smoke_config.py`, which runs with no database.

**Extra env var.** `MEETING_TARGET_SMOKE_DATABASE_PROVIDER` selects the provider
the stub claims (default `supabase`, preserving today's behaviour). Documented in
the runbook's reverse-cutover section.

---

## D7 — `packages/db` has no ESLint config (observed, not changed)

`bun run --cwd packages/db lint` fails with "ESLint couldn't find an eslint.config.js
file" on an unmodified checkout — a pre-existing gap, and the reason `verify:db` is
`typecheck && test` with no lint step. Not touched: fixing it is unrelated to this
plan and would be scope creep.
