# Decisions — memory personal tier (v1 slice)

Issue: `personal-vs-org-memory-b0d3975f` (a strict subset of `memory-meeting-access-authority-bdd55b7e`).
Research: `docs/research/2026-07-25-personal-vs-org-memory.md` rec #1, #2, and the cheap half of #7.

Scope built here: the ownership axis, fail-closed dual-lane retrieval, tier-aware attribution,
a bounded labelled personal injection lane. **Not** built: UI, promotion, redaction, curator,
divergence detection, recurrence triggers, the 2×2 holdout.

---

## D1 — `visibility` is a pgEnum, not text

The research allowed "enum-or-text". Every comparable axis in this schema (`memory_kind`,
`memory_status`, `memory_scope_type`, `memory_source_kind`, `memory_enforcement`, `injected_via`)
is a `pgEnum`, so an enum is the house style and gives the query planner a fixed-width value for
the new index. Two values only (`private`, `org`); a third would need a group-membership resolver.

## D2 — `owner_user_id` is `text`, with no foreign key

`created_by` and `decided_by` are already `text` holding Clerk user ids, and this schema owns no
`users` table (`tenants` is Alembic-owned and referenced by id only, without an FK). So there is
nothing to reference and no place to hang `ON DELETE`.

**Deferred, and it is a real gap:** research §2.4 point 5 requires user deletion to cascade or
force-resolve `owner_user_id`, because a private memory outliving its owner with a dangling owner
id is a fail-open bug (the row is unreachable rather than leaked, so it fails closed *for reads* —
but it is undeletable-by-design data with no lifecycle owner). Filed as a follow-up rather than
invented here, since the fix belongs with whatever owns user lifecycle, not with retrieval.

## D3 — the biconditional is a DB CHECK, never application code

`CHECK (("visibility" = 'private') = ("owner_user_id" IS NOT NULL))`. Both halves matter: a
private row with no owner is retrievable by nobody (silently dead memory), and an org row with an
owner is a mislabelled private one (a leak that reads as intentional). Research §2.1 is explicit
that a privacy boundary carried in `attrs` JSONB or `topics[]` fails open on every code path that
forgets it.

## D4 — the new index is ADDED, not swapped for the old one

`memories_tenant_visibility_scope_idx` on `(tenant_id, status, visibility, owner_user_id,
scope_type, scope_id)` is the shape both lanes now query. `memories_tenant_scope_idx`
`(tenant_id, status, scope_type, scope_id)` is kept: other domain queries (`listMemories` and
friends) still filter without a visibility term, and dropping the index they use is an unrelated
performance change I have not audited. Cost is one index on a table with zero rows today.

## D5 — no drizzle meta snapshot for 0016

The brief asked for the snapshot chain to be regenerated from the clean primary checkout. It was
not, deliberately: `packages/db/migrations/meta/` stops at `0011_snapshot.json`, and 0012–0015 all
ship SQL + journal only (each says so in its own header). Adding a lone `0016_snapshot.json` on
top of a chain that has been snapshot-less for four migrations would be inconsistent, and
regenerating 0012–0016 is a large diff unrelated to this slice. `check:migration-parity` — the
gate that actually runs — passes, because it compares the journal against the `.sql` files and
does not read snapshots. The stale snapshot chain is a pre-existing, ungated condition.

## D6 — attribution stores the tier denormalized

`run_memory_attributions.visibility` + `owner_matched`, rather than joining `memories` at read
time. Promotion (later work) writes a NEW row superseding the private one, so a join would report
a memory's *current* tier, not the tier it had when it influenced the run — which is exactly the
question the rail exists to answer. `owner_matched` separates "personal memory helped its owner"
from "an org row that happens to name someone".

## D7 — the private lane is a separate query, not a UNION

Research §2.2: two retrievals, not one query over a union. A single blended ranking lets a chatty
private note starve a load-bearing org rule, and the fail-closed test is only trivial when the
private lane is a distinct query that can be asserted absent.

## D8 — fail-closed means the lane is never queried

When the asker is unknown, absent, or an empty string, the private lane issues **no SQL at all**
and returns an empty result. It does not fall back to an unfiltered query, and it does not filter
in JavaScript after fetching — research §2.4 point 3: trim before the model, never after.

## D9 — the personal budget is additive, not carved out of the org budget

The org lanes keep their exact current budgets (`DEFAULT_MEMORY_TOKEN_BUDGET = 800`,
`DEFAULT_RULES_TOKEN_BUDGET = 400`). The personal lane gets its own ceiling —
15% of the memory budget, hard-capped at `MAX_PRIVATE_MEMORY_TOKEN_BUDGET` — on top. Taking the
personal share *out* of the org budget would reduce policy visibility to make room for personal
preference, which is privilege laundering in token form (§2.5). The brief also forbade
restructuring the existing org fence.

## D10 — the personal block is its own fence, rendered last

`<your_context>` is distinct from `<org_memory>` and `<team_rules>`, labelled as the asking user's
own private notes, and appended after both org fences so a truncated tail degrades the least
load-bearing lane first (§2.5). Returned from retrieval as a separate `privateFenced` string so
the runtime controls ordering; the existing org fence string is unchanged.

## D11 — private rules do not override org rules in v1

A private rule reaches only its owner's runs, but within those runs it is rendered in the personal
fence, *not* merged into `<team_rules>`. Research §2.2 requires org to win on `kind='rule'` and
divergence to be surfaced rather than silently resolved. Surfacing divergence is rec #4 and out of
scope here; keeping private rules in a separately-labelled fence is the honest v1 position,
because it means a private rule can never be read by the model as ratified team policy.

## D12 — real-DB execution of the CHECK is NOT possible in this repo

The brief asked for db-contract-tier tests. **There is no such tier in this repo.** No test in
`apps/platform-api` or `packages/db` connects to Postgres: `packages/db/src/schema.test.ts`
asserts Drizzle table config and reads the migration `.sql` text, and every
`apps/platform-api/src/**` test dispatches against a mocked `sql.query`
(`process.env.DATABASE_URL` is set to a dummy string where a route needs one to exist).

So the CHECK constraint is verified by asserting its exact SQL in the migration file, and the
retrieval invariants are verified by asserting the emitted SQL text and bound parameters. The
constraint's runtime rejection of `private` without an owner (and `org` with one) is **not**
executed anywhere — not in CI either. This is a genuine verification gap and is reported as such
rather than described as green.
