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

---

## D8 — A.1 is `0016_meeting_schema.sql`, and ships no snapshot (Task A.1)

**Numbering.** As D1 predicted: B.1 took `0015`, so the meeting schema is
`packages/db/migrations/0016_meeting_schema.sql`, journal `idx: 16`,
`when: 1784908800000` (one day after 0015, matching the chain's spacing).
`bun run check:migration-parity` passes.

**No snapshot — same reasoning as D2, deliberately not re-litigated.** `meta/`
still holds snapshots for `0000`–`0011` only; `0012`–`0015` each shipped
hand-authored SQL + a journal entry and nothing else. Generating a lone `0016`
snapshot would attach a fabricated link to a chain that stops five migrations
earlier — the regeneration has to be the whole run or none of it.

That whole-chain regeneration is already filed as kernel issue
**`regenerate-the-drizzle-snapshot-9d4188c6`** ("Regenerate the Drizzle snapshot
chain (0012-0015) from a clean primary checkout"); its scope is extended to
`0016` by a comment rather than by a second issue.

---

## D9 — The migration has ONE embedding column, not two (Task A.1)

`tasks.md` A.1 RED test 5 reads "The migration requires the `vector` extension
(both embedding columns depend on it)". The Supabase original
(`20260606093937_create_meeting_schema.sql`) declares exactly one:
`meeting.chapter_summaries.embedding extensions.vector(1536)` (line 154). No
other `meeting.*` column is a vector type.

**Decision.** The test asserts what is true — `create extension if not exists vector;`
plus the single `vector(1536)` column — rather than inventing a second embedding
column to satisfy the parenthetical. A.1 is a *port*: adding a column the source
does not have would put Neon out of shape with the Supabase database that is still
the rollback target.

**Vector qualifier.** `extensions.vector(1536)` → `vector(1536)`, with
`CREATE EXTENSION IF NOT EXISTS vector;` at the top — this repo's convention, set by
`0013_knowledge_base.sql:12`. The `extensions` schema is Supabase-specific.

**Dropped, per the GREEN scope:** the 19 `enable row level security` statements,
the `anon`/`authenticated`/`service_role` revoke+grant block, and the
`public.alembic_version` create/delete/insert. Kept verbatim: all 19 tables, all
19 indexes, the 5 table comments, the schema comment (reworded from "Supabase
migrations own hosted schema" to the Drizzle chain), and every TEXT id.

---

## D10 — B.2 is tested at BOTH tiers: mock unit + real-DB contract (Task B.2)

**The two tiers `apps/platform-api` actually has.**

1. **Mock unit** (`src/**/*.test.ts`, plain `vitest run`) — mocks
   `@product-suite/db` and drives a mock `Sql` whose `query` dispatches on SQL
   text. `agent/reflection.test.ts` is the reference shape; `src/meeting/*.test.ts`
   follows it.
2. **Real-DB contract** (`test/db-contract/**`, `vitest run --config
   vitest.db-contract.config.ts`, its own `db-contract` CI job) — `withDbBranch()`
   provisions an **ephemeral Neon branch**, applies the WHOLE migration journal,
   seeds a baseline tenant/team/statuses/run, and always deletes the branch.

B.2's DB-touching assertions belong in tier 2 and are there:
`test/db-contract/meeting-ingest.test.ts` — predicate filtering, tenant scoping,
one-run-per-call, full proposal provenance, real `work_items.source = 'meeting'`
after accept, the ledger row, dedup, rematerialization survival, and the empty run.
It is also the **only** place migration `0016_meeting_schema.sql` is ever executed
against Postgres, so an unapplyable meeting schema fails there.

**Honest limitation.** That file could not be RUN here: the tier is gated on
`NEON_API_KEY`/`NEON_PROJECT_ID` (`harness.ts::hasNeonCreds`), which this machine
does not have — `.dev.vars` carries a `DATABASE_URL` but no Neon control-plane key,
and pointing the tier at the shared dev database instead would be Task A.4's
[NEEDS USER GO] write. Locally it correctly self-skips and `tsc --noEmit` covers it
(`tsconfig.json` includes `test`). **The executed RED → GREEN evidence for B.2 is
the mock tier's; the db-contract tier is verified by CI's `db-contract` job.**

**Why the mock tier still carries tests 4a/4b.** A mock cannot enforce a `WHERE`,
so those two assert the predicate is present in the emitted SQL — which catches the
dropped clause the requirement is aimed at, fast, on every run. The contract tier
proves the same predicates *behave*, with one seeded row per excluded reason.

**Belt and braces added rather than argued around.** `runMeetingIngest` re-checks
every returned row against the tenant map even though the read is already
SQL-scoped, so test 5's "another meeting tenant's row is not proposed" is a
behavioural assertion at both tiers, not only a parameter one.

---

## D11 — `payload.source = 'meeting'` persists; the validator needed no widening (Task B.2)

RED test 11 anticipated that `createWorkItem` might drop `payload.source`, and
instructed: keep `payload.source`, drop the persistence assertion, file an issue.
**That branch did not fire.** Reading the path:

- `apply.ts::validateAndResolveWorkItemPayload` (:181-215) spreads the payload
  through untouched — it validates ids, it does not strip unknown keys.
- `domain/work-items.ts::createWorkItem` (:237) writes `source: input.source ?? 'manual'`.
- `packages/db/src/schema.ts:50` — `work_item_source` is a pg enum that **already
  contains `'meeting'`** (`['manual', 'meeting', 'agent', 'feedback']`).

So the assertion is kept, in the form this tier can prove: the test runs the real
`applyProposal` over a meeting-shaped proposal and asserts the (mocked) domain
command receives `source: 'meeting'`. Reading the value back out of a live
`work_items` row is E.1's job (its RED test 6 already anticipates this outcome).
**No validator change, no follow-up issue, no widened schema.**

---

## D12 — Where `skippedUnmappedTenant` comes from (Task B.2)

B.3's RED test 4 requires the unmapped count to be *visible, not silently zero*.
But the candidate read is tenant-scoped in SQL, so by construction it returns no
unmapped rows to count.

**Decision.** A second, separate query counts promoted+generated rows whose meeting
tenant is outside the allowed set — `count(*)` only, no columns. A number leaks
nothing across tenants, and it is the difference between "the map is fine, there is
simply no work" and "the map is missing an entry" for whoever is debugging.

The in-code re-check (D10) feeds the same counter, so a row that somehow arrives
from an unmapped tenant is both refused and reflected in the total.

**Anchoring.** `runMeetingIngest` takes ONE platform `tenantId` per call, mirroring
`runReflection` — `agent_runs.tenant_id` is single-valued, and one run per call
(RED test 6) forces the choice. The run is minted **unconditionally**, before any
candidate is read, which is also how RED test 15's "zero candidates" case is pinned.

---

## D13 — `apps/platform-api` has no ESLint config either (observed, not changed)

Same pre-existing gap as D7: `bun run --cwd apps/platform-api lint` fails with
"ESLint couldn't find an eslint.config.js file" on an unmodified checkout, which is
why `verify:platform-api` is `typecheck && test`. Not touched — out of scope, and
adding a config would silently start gating unrelated files.
