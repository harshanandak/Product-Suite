# Meeting → board end-to-end loop (design)

**Kernel issue:** `end-to-end-meeting-0c1a2ac1` (`0c1a2ac1-1ffa-4b61-af4a-fff6c4c2fb76`), epic
`91612c3f-3de8-4f1a-bb35-1e35e7befded`.
**Branch:** `feat/meeting-e2e-loop` · **Worktree:** `.worktrees/meeting-integration`
**Design authority:** the DESIGN DECIDED comment on the kernel issue (2026-07-24). This document does
not re-decide anything; it records the decision, grounds every mechanical detail in a cited source,
and hands `/dev` a task list.

> **SUPERSEDED IN PART — Task 0's reality check (2026-07-24).** The scout's TASK-0 VERDICT on the
> kernel issue found the meeting tables **already live in Neon's `public` schema** and PR20's Supabase
> cutover **never completed**. Slice A therefore has nothing to move: **A.1 is cancelled, A.4 and A.5
> are moot**, and both prod-write gates in §9 dissolve. Slice B reads `public.action_items` in the
> shared database. §3, §4 and §9 below are annotated accordingly; the goal, the brief alignment
> (§2), and Slices B/C are unaffected — they got *easier*, which was Slice A's whole point.

---

## 1. Goal

One sentence: **an extracted meeting action item becomes a proposal in the Review Inbox, and a human
accept lands it on the workboard.**

The loop reuses the moat loop verified green on 2026-07-24 (`apps/platform-web/e2e/moat-loop.spec.ts`)
end-to-end — propose → Review Inbox → accept → validated write. Nothing in this plan writes a work
item directly. **Propose-only.**

```text
meeting-api extraction          platform-api ingest              EXISTING (unchanged)
─────────────────────────       ─────────────────────────        ────────────────────────
chapter_summary.py              read meeting.action_items        proposals row (pending)
extract_generated_records  ───► where record_origin='generated'  ──► Review Inbox
  ↳ content-derived ids             and review_status='promoted'     ↳ human Accept
  ↳ confidence                  ↳ tenant map (TEXT → uuid)          ↳ applyProposal()
  ↳ review_status               ↳ dedup ledger (skip seen)          ↳ createWorkItem
                                ↳ mint agent_run + createProposal   ↳ workboard
```

## 2. How this honors the 2026-07-10 integration brief

Source: `docs/design/2026-07-10-meeting-module-rewrite-and-integration.md`.

| Brief position | This plan |
|---|---|
| **I2 — LINK + PROMOTE, not auto-become.** "Extraction produces meeting-owned candidate rows; a cheap, bulk, agent-suggested PROMOTE creates a `work_item` … Promotion is one-way." | Exactly what Slice B builds. Ingest reads candidate rows and emits **proposals**; only a human accept creates the work item. No row is auto-promoted. |
| "`work_items` require `team_id`, which is unknowable at extraction time." | The ingest **omits `team_id`**. `validateAndResolveWorkItemPayload` (apply.ts) resolves the caller's sole team at accept time via `resolveDefaultTeamId` (`apps/platform-api/src/domain/work-items.ts:94-112`) and snapshots it. Multi-team tenants surface `team_required_multiple` at accept — accepted for this slice (§6). |
| "Triage-flooding destroys board trust." | Ingest is gated to `review_status='promoted'` only, one pilot tenant, manual trigger. Draft/rejected candidates never reach the Inbox. |
| **Stop-list.** The brief scopes the module to **two** outward edges, PROMOTE and SEARCH, and forbids bidirectional sync, memory unification, MCP/model-router routing, merging meeting-specific models, and auto-create. | This plan builds **only PROMOTE** — a strict subset. SEARCH is not touched. No bidirectional sync (the ledger is one-way and platform-owned; nothing writes back into `meeting.*`). No MCP, no model router, no memory fold. |
| "It is the concrete prototype of the `proposals` queue: extraction *is* a proposal; promote *is* accept." | Literally the implementation: `createProposal(target_type='work_item', operation='create')`. |

**Resequencing (deliberate, recorded on the issue).** The brief sequences I1 (tenancy/auth
unification) → I5 (Drizzle schema) → core rewrite → I2. This plan does **I2 first, on a Neon-first
substrate**, because PR20's Supabase cutover has no recorded justification, meeting-api takes a
generic Postgres `DATABASE_URL` (`apps/meeting-api/backend/config.py:125`,
`backend/settings.py:56` — `DATABASE_URL` or `POSTGRES_URL`, no Supabase coupling) and ran on Neon
until 2026-06-03, and the brief's own endgame is Drizzle-owned tables on Neon anyway. Cutting the
meeting DB back to the shared Neon instance dissolves the cross-DB transfer, service-auth, and
tenant-id-shape risks **at the root** rather than engineering around them.

**I1 / I5 / the full rewrite stay a separate filed epic** (`91612c3f`) and get *easier*: after Slice A
the meeting tables are already in the same Postgres as `teams`/`work_items`, so I5's Drizzle adoption
and I1's `tenant_id` FK become in-database refactors instead of cross-service migrations.

## 3. Slice 0 — reality check (input, not work)

Run in parallel by another agent. Its report answers three questions and **sizes Slice A**:

1. Supabase `meeting.*` row counts — is there any real data?
2. Railway meeting-api liveness — is the service actually serving?
3. Neon has no `meeting` schema (expected; confirm).

Outcome was expected to route Slice A to one of:
- **(a) schema-apply only** — zero rows. Apply the schema to Neon, repoint, done. Expected case.
- **(b) small copy** — a handful of rows. `pg_dump --schema=meeting` → restore, inside the same task.
- **(c) real migration** — meaningful data. Slice A grows a data-movement task with its own backup
  proof; **stop and re-plan** rather than improvising a copy.

**Actual outcome (2026-07-24): none of the three — Slice A dissolves.** Question 3's premise was
false. The meeting tables are **already in Neon's `public` schema** (all 11, `alembic_version` at
`0005`); PR20's Supabase cutover never completed (`Status: dev`, smoke gate unpassed, legacy keys
disabled 2025-12-29, no Supabase connection string in any config); both hosted meeting deployments
404; and the data is 2 stale test meetings with 0 extraction rows. Tenancy is already physically
unified on `public.tenants`. **A.1 cancelled, A.4/A.5 moot.** Full verdict and consequences: Task 0.1
in [`tasks.md`](./tasks.md), from the TASK-0 VERDICT comment on the kernel issue.

## 4. Slice A — cut the meeting DB back to Neon *(mostly cancelled by Task 0)*

> **What actually happened.** Slice A's objective — meeting tables in the shared Neon database — was
> **already true** before the slice started (§3). The schema work (A.1) is cancelled and the
> operational steps (A.4, A.5) are moot. What ships from this slice is the **tooling**: A.2's
> direction-agnostic preflight and A.3's target-agnostic smoke, both now vendor-neutral and reusable
> by whatever future move I5 decides. §4's schema analysis below is retained as the record of what was
> designed, and as the input to I5 — not as work to do.

**What was intended.** Create the `meeting` schema inside the **shared Neon platform database** and
point meeting-api's `DATABASE_URL` at it. Supabase becomes rollback-only, then dead.

**Schema source.** `infra/supabase/migrations/20260606093937_create_meeting_schema.sql` — adapted:

- **Keep**: `create schema meeting`, all 19 tables, all indexes, the `vector` extension requirement
  (`meeting.summaries.embedding extensions.vector(1536)`, `meeting.chapter_summaries.embedding`).
- **Keep TEXT ids as-is.** `meeting.tenants.id`, `meeting.action_items.tenant_id`, every `id text
  primary key` stays TEXT. **No id-shape change in this slice** — that is I1's job. The TEXT→uuid
  gap is bridged by the explicit tenant map in Slice B, not by a migration.
- **Drop the Supabase-isms**: `alter table … enable row level security` (19 statements), the
  `revoke … from anon, authenticated` / `grant … to service_role` block, and the `extensions` schema
  qualifier on `vector` (Neon installs it into `public` or a chosen schema — the migration must
  create it wherever `packages/db` conventions place extensions). Neon has no `anon`/`authenticated`/
  `service_role` roles; those statements fail. Access control is the connection string, as it already
  is today (the SQL's own comment: *"Meeting API runtime access uses the privileged Postgres
  DATABASE_URL"*).
- **Drop** `public.alembic_version` seeding — the platform DB's `public` schema is Drizzle-owned.
  Alembic history stays read-only for meeting-api; if meeting-api's Alembic env still asserts a
  version row it must live in the `meeting` schema, not `public`.

**Where the migration lives.** `packages/db/migrations/` is Drizzle's journal-ordered chain (0000 →
0014 at planning time) and `packages/db/src/schema.ts` is its source of truth. The meeting tables are
**not** Drizzle-modelled in this slice (that is I5). Two options; hand-authored SQL in the Drizzle
chain wins over a separate meeting-only runner — two runners against one database is exactly the drift
this slice exists to remove.

**As built, after Task 0 cancelled A.1** — the numbering and the snapshot question resolved as
follows (D1 and D2 in [`decisions.md`](./decisions.md)):

- **`0015` is `0015_meeting_promotions.sql`** — B.1's dedup ledger, the only migration this plan
  ships. It took the next free number because the journal must be a contiguous `0..N` sequence;
  reserving `0015` for A.1's unwritten migration would have kept `check-migration-parity`
  (`scripts/check-migration-parity.mjs`) red.
- **`0016` is reserved for a future meeting schema** if I5 ever needs one. It is not written here.
- **Snapshot regeneration is deferred, not done.** `packages/db/migrations/meta/` holds snapshots for
  `0000`–`0011` only; `0012`–`0014` each shipped hand-authored SQL and a journal entry with no
  snapshot. The parity gate compares the journal against the `.sql` files and never reads snapshots.
  Adding a lone `0015` snapshot on top of a chain that stops at `0011` would be a fabricated link, so
  regenerating `0012`–`0015` from a clean primary checkout (a worktree cannot resolve `drizzle-orm`)
  is filed as a repo-wide chore instead.

**Preflight/smoke, reversed.** PR20 shipped real tooling; reuse it rather than writing new:

- `scripts/meeting-cutover-preflight.mjs` — exports `MEETING_SOURCE_TABLES` (19 tables, line 6),
  `REQUIRED_TARGET_EXTENSIONS` (`["vector"]`, line 28), `buildSourceRowCountSql({schemaName})` (35),
  `buildTargetReadinessSql({schemaName})` (77), `evaluatePreflight({sourceRows, targetTables,
  targetExtensions, approvedDataMigration})` (116), `runPreflight()` (184). Run via
  `bun run preflight:meeting-cutover` (`package.json:27`).
  **The reversal was one change**: `runPreflight` hardcoded source `schemaName: "public"` (Neon) and
  target `schemaName: "meeting"` (Supabase). Both sides are now parameterised — and, after review, so
  are the connection slots (`MEETING_PREFLIGHT_SOURCE_DATABASE_URL` / `..._TARGET_DATABASE_URL`) and
  the provider labels recorded in the archived report (`MEETING_PREFLIGHT_SOURCE_PROVIDER` /
  `..._TARGET_PROVIDER`, `unspecified` when unset). No vendor name is hardcoded anywhere, so archived
  evidence can no longer misname the side it describes. The fail-closed gate
  (`approvedDataMigration`) and the row-count/extension checks are direction-agnostic and unchanged.
- `test/meeting-cutover-preflight.test.js` and `test/meeting-supabase-cutover-docs.test.js` — the
  existing unit + docs tests; both are in the `test:repo-tooling` suite (`package.json:41`).
- `apps/meeting-api/tests/backend/test_target_db_create_read_smoke.py` (renamed from
  `test_supabase_create_read_smoke.py`) — a real create/read against a live Postgres, now gated on
  `MEETING_TARGET_SMOKE_DATABASE_URL` with the Supabase-specific variable still honoured, so the same
  smoke proves **any** target Postgres. Its no-database assertions live in the sibling
  `test_target_db_smoke_config.py` (D6).
- `docs/deployment/MEETING_SUPABASE_CUTOVER.md` — the runbook (preflight → cutover order → rollback →
  retirement criteria). Gets a reverse-direction section; the docs test enforces it stays honest.

**Rollback.** Supabase stays intact and reachable until the Neon smoke passes. Rollback = set
`DATABASE_URL` back to the Supabase runtime URL and redeploy — the same shape the PR20 runbook already
documents. Nothing is dropped from Supabase in this slice.

## 5. Slice B — the promote bridge (platform-api, same DB)

A new ingest module in `apps/platform-api`. Five parts, all inside the existing propose-only loop.

### 5.1 Read the candidates

```sql
select id, tenant_id, meeting_id, text, evidence_refs, confidence, promotion_reason,
       chapter_summary_id, created_at
from public.action_items
where record_origin = 'generated' and review_status = 'promoted' and tenant_id = $1
```

**`public`, not `meeting`** — per Task 0 the tables were never moved out of Neon's `public` schema, so
Slice A's schema qualifier is the one thing about Slice B that changed. Everything else below stands.

Column shapes verified against the migration: `id text primary key`, `tenant_id text not null`,
`text text not null`, `evidence_refs jsonb default '[]'`, `record_origin text default 'generated'`,
`review_status text default 'draft'`, `confidence double precision default 0`, `promotion_reason
text`, `source_window_start/end double precision`.

Same-database read via the platform's own `sql` handle — no HTTP, no service token, no cross-DB
transfer. This is the whole point of doing Slice A first.

### 5.2 Explicit tenant map — fail-closed

Meeting ids are TEXT (`meeting.tenants.id text primary key`); platform `tenant_id` is a Clerk-bridged
uuid-shaped TEXT (`proposals.tenantId: text('tenant_id')`, `packages/db/src/schema.ts`). There is no
derivation between them and inventing one is how cross-tenant leaks happen.

**Decision: an explicit map, pilot tenant only, fail-closed.** An unmapped meeting `tenant_id` is
**skipped and reported**, never guessed, never defaulted. The task list implements it as config
(env-driven, one pair) so it needs no migration and no UI; a table is the natural upgrade when a
second tenant arrives.

### 5.3 Dedup ledger — keyed to survive rematerialization

`apps/meeting-api/backend/server.py` (the block around lines 2156–2215) **deletes and re-inserts**
generated records on every re-summarize:

```python
for table_name in ("decisions", "action_items", "open_questions"):
    cur.execute("DELETE FROM {table} WHERE meeting_id = $1 AND tenant_id = $2 AND record_origin = 'generated'")
# … then re-INSERTs each record with record["id"]
```

The re-inserted `record["id"]` is **content-derived** (`chapter_summary.py::extract_generated_records`),
so an unchanged action item keeps the SAME id across rematerializations. That makes the record id —
not a row rowid, not a timestamp — the only stable dedup key.

New table in the platform (Neon) schema:

```text
meeting_promotions
  meeting_record_id  text     -- the content-derived public.action_items.id
  tenant_id          text     -- PLATFORM tenant uuid (post-map)
  proposal_id        uuid     -- → proposals.id
  created_at         timestamptz
  unique (tenant_id, meeting_record_id)
```

Keyed on `(tenant_id, meeting_record_id)`, not `meeting_record_id` alone — a content hash could
theoretically collide across tenants, and a cross-tenant skip would be a silent data leak. **An
already-ledgered id is skipped.** Re-running ingest after a re-summarize proposes nothing new for
unchanged items; a genuinely edited item gets a new content-derived id and is proposed once.

### 5.4 Mint ONE run, then one proposal per new candidate

Model: `apps/platform-api/src/agent/reflection.ts:106-112` — mint the run first as the attributable
actor (it satisfies `apply.ts`'s `run_id` and the `source_run_id` FK), with a reserved sentinel in
`triggered_by` that is explicitly *not* a user id:

```ts
insert into "agent_runs" ("tenant_id","triggered_by","kind","status","memory_holdout")
values ($1, 'meeting-ingest', 'agent_run', 'running', false) returning id
```

Then per new candidate, following `reflection.ts`'s `createProposal` call shape
(`apps/platform-api/src/proposals/repository.ts:97`, `CreateProposalInput` at :44):

| field | value | why |
|---|---|---|
| `tenant_id` | mapped platform tenant | tenant-scoped like every proposal |
| `run_id` | the minted run id | attributable actor |
| `target_type` | `'work_item'` | the board item to be |
| `operation` | `'create'` | propose-only create |
| `payload` | `{ title: <candidate text>, source: 'meeting' }`, **`team_id` OMITTED** | see below |
| `rationale` | derived from `promotion_reason` / `evidence_refs` / `confidence` | the human's reason to accept |
| `confidence` | the candidate's `confidence` | a real column on `proposals` |
| `context_ref` | the meeting record id | traces back to the exact candidate |
| `actor_type` | `'agent'` | `actorTypeEnum` default, made explicit |
| `actor_id` | the run id | mirrors reflection.ts |
| `prompt_version` | `'meeting-ingest-v1'` | a version swap stays measurable |

**On `source`.** `proposals` has **no `source` column** — the insert allowlist is
`tenant_id, run_id, target_type, target_id, operation, payload, rationale, confidence, risk_level,
target_version, model_id, prompt_version, context_ref, actor_type, actor_id, on_behalf_of`
(`repository.ts:76-93`), and the web layer's source facet (`chat|autonomous|connector`,
`apps/platform-web/src/data/proposals/network-repository.ts:4-11`) normalizes anything unrecognised to
`null`. So per the brief's own conditional, `source` goes in the **payload**:
`work_items.source` is a real enum with a `meeting` member
(`workItemSourceEnum('work_item_source', ['manual','meeting','agent','feedback'])`,
`packages/db/src/schema.ts:50`, column at :293). Provenance is otherwise carried by `run_id`,
`context_ref`, `prompt_version`, and — after accept — `work_items.applied_from_proposal_id`.
**Task B.2's first RED test pins whether the create path actually persists `payload.source`**;
`validateAndResolveWorkItemPayload` (apply.ts) validates only `status_id`/`project_id`/`parent_id`/
`team_id` shapes and does not strip unknown keys, so the question is whether `createWorkItem` accepts
it. If it does not, the fallback is provenance-only and a follow-up issue — **not** a widened
validator.

**On the omitted `team_id`.** Deliberate, per the brief ("`team_id` … is unknowable at extraction
time"). `apply.ts` resolves the sole team at accept and snapshots it into `edited_payload`
(`resolveDefaultTeamId`, work-items.ts:94-112). Multi-team tenants get `team_required_multiple` at
accept — a clean, reviewable 4xx with the proposal left `pending`, not a crash. Acceptable for a
single-pilot-tenant slice; a team-picker in the Inbox is the natural follow-up.

### 5.5 The endpoint — Clerk-authed, manual, no cron

`POST /api/agent/meeting-ingest`, mounted in `apps/platform-api/src/app.ts` beside the existing agent
routes (`/api/agent/proposals` :44, `/api/agent/chat` :47, `/api/agent/threads` :50,
`/api/agent/reflection` :53, `/api/agent/kb` :56, `/api/agent/memory-impact` :59). Tenant scope via
`callerTenantIds(sql, claims)` exactly as `agent-reflection.ts:100` does — a caller can only ingest
into a tenant they belong to.

**No cron in this slice.** A scheduled ingest is a different risk profile (unattended writes into a
human queue) and belongs behind a working manual path with real usage.

## 6. Slice C — honest nav

Today all five meeting nav rows point at `BoardScreen`, a shared placeholder
(`apps/platform-web/src/router.tsx:175-199`: `meetings`, `meetings/week`, `meetings/actions`,
`meetings/triage`, `meetings/jobs`), and `shell/boards.ts:185-220` decorates three of them with
**hardcoded fake counts** (`action-items: 4`, `triage-queue: 2`, `jobs: 1`). Fake counts on a
placeholder is worse than no entry.

- **Make ONE real:** the meeting triage screen — lists candidate/promoted meeting action items with
  their promotion state: *unpromoted* / *proposal pending* / *accepted → work item* (a link). Plus a
  **"Sync now"** button that POSTs the ingest endpoint, and a deep-link into the Inbox at
  `?proposal=<id>` (the parameter `InboxScreen` already honors —
  `apps/platform-web/src/boards/inbox/InboxScreen.tsx`, `useSearch({from: "/w/$workspace/inbox"})`).
- **Model:** `InboxScreen.tsx` — repository seam as the only prop (optional, defaulting to the shared
  singleton), the four loading/empty/error/ready states, `EmptyState`/`ErrorState` from
  `@product-suite/ui`.
- **Remove the other three** (`this-week`, `action-items`, `jobs`) from `boards.ts` and delete their
  route definitions, along with the now-unused lucide imports. `all-meetings` stays as the board entry.
  Removal, not a stub: a nav row that goes nowhere teaches users the product is hollow.

## 7. E2E verification

Extend the harness in `apps/platform-web/e2e/` with `meeting-loop.spec.ts`, modelled on
`moat-loop.spec.ts` (137 lines) and reusing `db-provenance.e2e.ts`'s `readWorkItemAppliedFrom` for the
persisted-provenance assertion. Local mode, real Neon, Clerk testing token via
`setupClerkTestingToken` in `beforeEach`.

Shape: **seed** a `meeting.action_items` row (`record_origin='generated'`,
`review_status='promoted'`, unique content-derived id per run — `moat-loop.spec.ts` uses a
`Date.now()` suffix for exactly this reason) → **trigger** ingest → the proposal appears in the
Review Inbox pending list (`getByRole("list", { name: "Pending proposals" })`) → **accept**
(`getByRole("button", { name: "Accept" })` → "View item →") → the item is on the workboard → **and**
`work_items.applied_from_proposal_id` equals the accepted proposal id, with the item carrying meeting
provenance.

The spec proves the loop, not the UI: it is the definition of done for this whole plan.

## 8. What this plan does NOT do

- No id-shape change (TEXT stays TEXT) — I1.
- No Drizzle modelling of meeting tables — I5.
- No auth unification; meeting-api keeps HMAC/Neon-JWKS — I1, and its callers need a machine-
  credential answer first (the brief's open question 1).
- No cron / autonomous ingest.
- No bidirectional sync; nothing writes into `meeting.*`.
- No meeting UI rewrite; `apps/meeting-web` untouched.
- No SEARCH edge.

## 9. Prod-write gates — **all withdrawn (Task 0)**

Both gates below existed to guard Slice A's infrastructure writes. Task 0 established there is nothing
to write: the schema already exists in Neon `public`, and no hosted meeting service is running. **This
plan now contains no step that mutates real infrastructure**, so it needs no execution-time go-ahead.

1. ~~**A.4 — apply the `meeting` schema to the shared Neon database.**~~ **MOOT** — already present.
2. ~~**A.4 — data copy.**~~ **MOOT** — no populated source; PR20's Supabase project was never
   populated and its keys are disabled. The preflight's `approvedDataMigration` gate stays fail-closed
   by design for any future move, and must never be flipped just to pass.
3. ~~**A.5 — repoint meeting-api's `DATABASE_URL` on Railway** and redeploy.~~ **MOOT** — the hosted
   service 404s; there is nothing to repoint.
4. ~~**A.5 — Supabase retirement.**~~ Out of scope, as before, and now trivially so: nothing depends
   on the Supabase project.

**If a future cutover is ever decided**, it re-earns its own gates and its own plan. Nothing here
pre-approves it.

## 10. Sources

- Kernel issue `end-to-end-meeting-0c1a2ac1`, DESIGN DECIDED comment 2026-07-24 — the decision record.
- Kernel issue `end-to-end-meeting-0c1a2ac1`, **TASK-0 VERDICT** comment 2026-07-24 — the reality
  check that cancelled A.1 and mooted A.4/A.5.
- `docs/design/2026-07-10-meeting-module-rewrite-and-integration.md` — §I2, §3 stop-list, §4 sequencing.
- `infra/supabase/migrations/20260606093937_create_meeting_schema.sql` — the schema to adapt.
- `scripts/meeting-cutover-preflight.mjs`, `test/meeting-cutover-preflight.test.js`,
  `test/meeting-supabase-cutover-docs.test.js`, `docs/deployment/MEETING_SUPABASE_CUTOVER.md`,
  `apps/meeting-api/tests/backend/test_target_db_create_read_smoke.py` (+ `test_target_db_smoke_config.py`)
  — PR20's preflight/smoke machinery, generalised by A.2/A.3.
- `apps/meeting-api/backend/server.py` ~2156-2215 — the delete/re-insert rematerialization.
- `apps/meeting-api/backend/config.py:125`, `backend/settings.py:56` — generic Postgres `DATABASE_URL`.
- `apps/platform-api/src/agent/reflection.ts:106-112` — the run-minting + `createProposal` model.
- `apps/platform-api/src/proposals/repository.ts:44-118` — `CreateProposalInput`, insert allowlist.
- `apps/platform-api/src/proposals/apply.ts` — `memoryCreatePayload` zod pattern (:72),
  `validateAndResolveWorkItemPayload`, accept-time team resolution.
- `apps/platform-api/src/domain/work-items.ts:94-112` — `resolveDefaultTeamId`, `team_required_multiple`.
- `apps/platform-api/src/app.ts:35-62` — route mounting; `src/routes/agent-reflection.ts:100` —
  `callerTenantIds`.
- `packages/db/src/schema.ts:50,293` — `workItemSourceEnum` incl. `meeting`; `packages/db/migrations/`.
- `apps/platform-web/src/shell/boards.ts:185-220`, `src/router.tsx:175-199` — the stub nav + routes.
- `apps/platform-web/src/boards/inbox/InboxScreen.tsx` — the screen model + `?proposal=` deep link.
- `apps/platform-web/e2e/moat-loop.spec.ts`, `e2e/db-provenance.e2e.ts` — the E2E harness pattern.
