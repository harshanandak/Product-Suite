# Tasks — meeting → board end-to-end loop

Design: [`plan.md`](./plan.md) · Kernel issue `end-to-end-meeting-0c1a2ac1` · Branch `feat/meeting-e2e-loop`

Each task runs the `/dev` TDD loop: **RED** (write the failing test, show it fail) → **GREEN**
(minimal implementation, show it pass) → **REFACTOR** (clean while green), then spec + quality review.

**11 tasks.** Prod-write steps are marked **[NEEDS USER GO]** — the code and tests are written
without gating, but *executing* them against real infrastructure needs the user's explicit go-ahead.

## Dependency graph

```
0.1 ──┬─► A.1 ──┬─► A.2 ──► A.3 ──► A.4 [GO] ──► A.5 [GO] ──┐
      │         │                                            │
      │         └──────────────────► B.2 ──► B.3 ────────────┼─► E.1
      │                               ▲                      │
      └─► B.1 ───────────────────────-┘                      │
                                                             │
          C.1 ──► C.2 ──► C.3 ─────────────────────────────--┘
```

Edges that matter:

- **B.1 does not wait for Slice A.** The dedup ledger is a platform-schema migration in Neon; it
  touches nothing meeting-side. Start it in parallel with A.1.
- **B.2 depends on A.1 (schema exists in Neon), NOT on A.4/A.5 (the cutover).** Once the `meeting`
  schema is applied locally, B.2's real-DB tests can seed and read `meeting.action_items` without the
  hosted service ever being repointed.
- **C.1–C.3 are fully parallel** to A and B until C.3's "Sync now" needs B.3's endpoint to exist for
  its integration test; C.1 and C.2 have no cross-slice dependency at all.
- **E.1 requires B.3 + C-slice routes + a Neon-resident `meeting` schema.** It does *not* require the
  hosted Railway repoint — it runs against local + real Neon.

---

## Slice 0 — reality check

### Task 0.1 — Consume the reality-check report and size Slice A

**Goal.** Turn the parallel scout agent's findings into a recorded decision that sizes Slice A. No
code.

**Files.**
- Create `docs/work/2026-07-24-meeting-e2e-loop/decisions.md` (the `/dev` decisions log; open it with
  this entry).
- Comment on kernel issue `end-to-end-meeting-0c1a2ac1`.

**RED.** None — this task produces no code. (The `/dev` TDD gate is N/A; record the exemption in
`decisions.md`.)

**GREEN scope.**
1. Read the reality-check report: Supabase `meeting.*` row counts per table, Railway meeting-api
   liveness, confirmation that Neon has no `meeting` schema.
2. Record the branch: **(a)** schema-apply only (zero rows) · **(b)** small copy · **(c)** real
   migration.
3. If **(c)** — **STOP**. A meaningful data migration needs its own plan and backup proof; report it
   and do not improvise a copy inside A.4.
4. If **(b)** — note the exact tables + counts; A.4 grows a `pg_dump --schema=meeting` / restore step
   with the preflight's `approvedDataMigration` evidence recorded, not bypassed.

**Done when.** `decisions.md` names the live branch with the row counts that justify it, a kernel
comment mirrors it, and (if (c)) the stop is reported rather than worked around.

---

## Slice A — cut the meeting DB back to Neon

### Task A.1 — Neon `meeting` schema migration ~~(Drizzle chain, TEXT ids unchanged)~~

> **CANCELLED by Task 0's reality check.** The premise is false: the meeting tables were never
> moved out of the shared Neon database. A read-only `information_schema` query confirms
> `public.action_items`, `public.meetings`, `public.decisions`, `public.open_questions`,
> `public.chapter_summaries` and `public.transcript_segments` already exist in `public`,
> alongside `work_items` / `proposals` / `agent_runs`, with `public.tenants` already the shared
> tenant table both sides FK into — and there is **no `meeting` schema** (schemas present:
> `drizzle`, `neon_auth`, `public`). The Supabase project this ported from is dead and its
> cutover never completed.
>
> It was implemented and committed as `83261fc`, then **reverted** (`572ffbc`). See
> [`decisions.md`](./decisions.md) **D8**. B.2 retargets to `public.action_items` (**D14**).
> **A.4 and A.5 are MOOT** in consequence — nothing to apply, and no live Railway meeting-api
> to repoint.

**Goal (historical).** A migration that creates the full `meeting` schema in the shared Neon
platform database, adapted from the Supabase original with the Supabase-only constructs removed.

**Files.**
- Create `packages/db/migrations/0015_meeting_schema.sql`
- Modify `packages/db/migrations/meta/_journal.json` (+ regenerated snapshot chain)
- Create `test/meeting-neon-schema.test.js` (bun; add to `test:repo-tooling` in `package.json:41`)

**RED — test list.**
1. The migration declares all 19 tables from `MEETING_SOURCE_TABLES`
   (`scripts/meeting-cutover-preflight.mjs:6`) — assert the exported list is a subset of the tables
   the migration creates, so a table added there can never silently miss the schema.
2. Every `id` and `tenant_id` column in the migration is `text` — no `uuid`. (Pins "no id-shape change
   in this slice".)
3. The migration contains **no** `enable row level security`, no `anon`/`authenticated`/`service_role`
   grant or revoke, and no `extensions.` schema qualifier — those are Supabase-only and fail on Neon.
4. The migration does not touch `public.alembic_version` (the platform `public` schema is Drizzle-owned).
5. The migration requires the `vector` extension (both embedding columns depend on it).
6. `check-migration-parity` (`scripts/check-migration-parity.mjs`) passes with the new entry — the
   journal and the file agree.

**GREEN scope.** Port the DDL from `infra/supabase/migrations/20260606093937_create_meeting_schema.sql`:
keep `create schema meeting`, all 19 `create table` statements, all `create index` /
`create unique index` statements, and the table comments. Drop the 19 RLS statements, the
revoke/grant block, and the `alembic_version` seeding. Qualify `vector` per this repo's convention
rather than Supabase's `extensions` schema.

**REFACTOR.** No duplicated table lists — derive from `MEETING_SOURCE_TABLES` where the test needs a
list.

**Done when.** Tests green; the snapshot chain is regenerated **from a clean primary checkout** (a
worktree cannot resolve `drizzle-orm`); `check-migration-parity` and `test:repo-tooling` pass.

---

### Task A.2 — Reverse the cutover preflight (Supabase → Neon)

**Goal.** The preflight runs in the new direction without forking the script: source schema `meeting`
(Supabase), target schema `meeting` (Neon).

**Files.**
- Modify `scripts/meeting-cutover-preflight.mjs`
- Modify `test/meeting-cutover-preflight.test.js`

**RED — test list.**
1. `runPreflight` accepts a source schema name and passes it to `buildSourceRowCountSql` — currently
   hardcoded `"public"` at line 197.
2. `runPreflight` accepts a target schema name and passes it to `buildTargetReadinessSql` — currently
   hardcoded `"meeting"` at line 198 (it happens to be right in the new direction; the test pins that
   it is *passed*, not incidental).
3. Reverse direction: with source schema `meeting`, the generated row-count SQL qualifies every table
   as `meeting.<table>`.
4. `evaluatePreflight` is unchanged in behaviour — the fail-closed gate still fails when
   `sourceRows` has data and `approvedDataMigration` is false. (Regression pin: reversing direction
   must not weaken the gate.)
5. Missing target tables and a missing `vector` extension still fail, reading the Neon target.

**GREEN scope.** Parameterise both `schemaName` arguments in `runPreflight` (defaults preserving the
current forward direction, so no existing caller changes) and thread them from env/CLI. Nothing else.

**REFACTOR.** No copy of the table list; `MEETING_SOURCE_TABLES` stays the single source.

**Done when.** `bun test test/meeting-cutover-preflight.test.js` green; the forward direction still
works with default arguments.

---

### Task A.3 — Generalise the create/read smoke to any target Postgres + reverse runbook

**Goal.** The same smoke test proves the Neon target; the runbook documents the reverse cutover and
rollback.

**Files.**
- Modify `apps/meeting-api/tests/backend/test_supabase_create_read_smoke.py` (rename to
  `test_target_db_create_read_smoke.py`)
- Modify `docs/deployment/MEETING_SUPABASE_CUTOVER.md`
- Modify `test/meeting-supabase-cutover-docs.test.js`

**RED — test list.**
1. (pytest) The smoke skips on a neutral env var (e.g. `MEETING_TARGET_SMOKE_DATABASE_URL`) rather
   than the Supabase-specific `MEETING_SUPABASE_SMOKE_DATABASE_URL`; the old var still works so a
   half-migrated operator env does not silently skip.
2. (pytest) The smoke does not assert `database_provider == "supabase"` — the settings stub takes the
   provider as a parameter, so a `neon` provider is equally valid.
3. (docs test) The runbook documents the **reverse** direction: preflight command + required env
   vars, cutover order, rollback to Supabase, and Neon-as-target retirement criteria for Supabase.
4. (docs test) The runbook still documents the fail-closed data-migration gate and never instructs
   setting the approval flag to bypass it.

**GREEN scope.** Env-var rename with back-compat, parameterise the provider in the settings stub, add
the reverse-direction section to the runbook.

**Done when.** `test:repo-tooling` green; meeting-api pytest green; the runbook reads correctly for an
operator doing Supabase → Neon.

---

### Task A.4 — Apply the `meeting` schema to Neon ~~**[NEEDS USER GO]**~~

> **MOOT — cancelled with A.1.** The meeting tables already exist in Neon `public`; there is no
> schema to apply and no Supabase source to copy from (that project is dead, and the source
> table it would have read had 0 extraction rows anyway). See `decisions.md` **D8**.

**Goal (historical).** The `meeting` schema exists in the shared Neon platform database.

**Files.** No source changes. Produces `docs/deployment/meeting-neon-preflight.json` (the archived
preflight report).

**RED.** N/A (an operational step). Its correctness was tested in A.1–A.3.

**GREEN scope.**
1. **[NEEDS USER GO]** Run the A.1 migration against the Neon platform database.
2. Run the reversed preflight (A.2) — Supabase source, Neon target. Archive the report.
3. If Slice 0 landed on branch **(b)**: **[NEEDS USER GO]** `pg_dump --schema=meeting` from Supabase →
   restore into Neon, with backup evidence recorded before the preflight's `approvedDataMigration`
   flag is used. **Never** set that flag to make a red preflight go green.
4. Run the A.3 smoke against the Neon target URL.

**Done when.** Preflight report archived and passing, smoke green against Neon, and the user has
explicitly approved each write step. Supabase is untouched and remains the rollback target.

---

### Task A.5 — Repoint meeting-api `DATABASE_URL` to Neon ~~**[NEEDS USER GO]**~~

> **MOOT — cancelled with A.1.** There is no live Railway meeting-api to repoint, and the
> database it would be repointed *to* is the one the tables already live in. See
> `decisions.md` **D8**.

**Goal (historical).** The hosted meeting-api reads and writes the Neon `meeting` schema.

**Files.** Hosted env only (Railway). Update `docs/deployment/SERVICE_INVENTORY.md` to match.

**RED.** N/A (operational).

**GREEN scope.**
1. **[NEEDS USER GO]** Set the hosted `DATABASE_URL` to the Neon runtime URL (`config.py:125` /
   `settings.py:56` take a generic Postgres URL — no code change) and set `DATABASE_PROVIDER`
   accordingly if the deployment uses that label. Redeploy.
2. Health check + create/read smoke against the hosted service.
3. Record the rollback trigger: revert `DATABASE_URL` to Supabase and redeploy. **Do not delete
   anything from Supabase in this task** — retirement is a separate, later decision.

**Done when.** Hosted meeting-api is green on Neon, the inventory doc matches reality, and the
rollback path is verified reachable.

---

## Slice B — the promote bridge

### Task B.1 — `meeting_promotions` dedup ledger *(parallel with A.1)*

**Goal.** A platform-schema table that records which meeting record ids have already been proposed,
keyed to survive meeting-api's delete/re-insert rematerialization.

**Files.**
- Modify `packages/db/src/schema.ts`
- Create `packages/db/migrations/0016_meeting_promotions.sql` (+ journal/snapshot)
- Modify `packages/db/src/schema.test.ts`

**RED — test list.**
1. `meetingPromotions` declares `meeting_record_id` (text), `tenant_id` (text), `proposal_id` (uuid,
   FK → `proposals.id`), `created_at`.
2. A **unique index on `(tenant_id, meeting_record_id)`** — not on `meeting_record_id` alone. Assert
   the composite explicitly: a content-derived id colliding across tenants must not cause a
   cross-tenant skip.
3. `meeting_record_id` is `text` — it holds meeting-api's content-derived id, never a uuid.
4. The FK to `proposals` is declared (the ledger row is meaningless without its proposal).
5. Migration parity passes.

**GREEN scope.** The Drizzle table + hand-authored migration. Nothing reads or writes it yet.

**REFACTOR.** Document *on the table* why the key is the content-derived record id, citing
`server.py`'s delete/re-insert — the next reader must not "simplify" it to a row id.

**Done when.** Schema tests + migration parity green.

---

### Task B.2 — The ingest module: read → map → dedup → mint → propose

> **Retargeted:** reads **`public.action_items`**, not `meeting.action_items` — A.1 is cancelled
> and the table already lives in the platform `public` schema (column set verified from the live
> database; see `decisions.md` **D14**). The tenant map becomes an identity **allowlist** rather
> than a translation table, and stays fail-closed (**D15**). Every other rule below is unchanged.

**Goal.** A pure-ish module that turns promoted meeting action items into pending proposals, exactly
once each. ~~**Depends on A.1** (the `meeting` schema must exist to read)~~ and **B.1** (the ledger).

**Files.**
- Create `apps/platform-api/src/meeting/ingest.ts`
- Create `apps/platform-api/src/meeting/ingest.test.ts`
- Create `apps/platform-api/src/meeting/tenant-map.ts` + `tenant-map.test.ts`

**RED — test list.**

*Tenant map (pure, unit):*
1. A configured meeting TEXT tenant id maps to its platform uuid tenant id.
2. An **unmapped** meeting tenant id is refused — fail-closed. No default, no passthrough, no
   "use the only tenant" fallback.
3. A malformed/empty configuration yields an empty map that refuses everything, rather than throwing
   at import time.

*Ingest (real-DB, per project convention — the reflection.ts unit harness is the shape for pure
logic; the DB-touching paths get real-DB tests):*
4. Reads only candidates with `record_origin='generated'` **and** `review_status='promoted'` — a
   `draft` or non-generated row is never proposed. (Two separate tests: one per predicate, so a
   dropped clause cannot hide.)
5. Reads only the mapped tenant's rows; another meeting tenant's promoted row is not proposed.
6. Mints **exactly one** `agent_runs` row per ingest call, with `triggered_by='meeting-ingest'`,
   `kind='agent_run'` — regardless of candidate count. (Mirrors `reflection.ts:106-112`.)
7. Creates one proposal per new candidate with `target_type='work_item'`, `operation='create'`,
   `status` defaulting to `'pending'`.
8. The proposal's `payload.title` is the candidate `text`; **`payload.team_id` is absent** (assert
   the key is not present, not merely falsy).
9. `context_ref` equals the meeting record id; `run_id` = the minted run; `actor_type='agent'`;
   `actor_id` = the run id; `prompt_version='meeting-ingest-v1'`; `confidence` = the candidate's.
10. `rationale` is non-empty and derived from the candidate's `promotion_reason`/`evidence_refs`/
    `confidence` — a human can see why it was proposed.
11. **`payload.source`**: assert `payload.source === 'meeting'` is set AND that accepting such a
    proposal persists `work_items.source = 'meeting'`. If the create path drops it (the validator at
    `apply.ts::validateAndResolveWorkItemPayload` does not strip unknown keys, so this hinges on
    `createWorkItem`), **do not widen the validator** — keep `payload.source`, drop the persistence
    assertion, and file a follow-up issue. Record the outcome in `decisions.md`.
12. **Dedup:** a candidate already in `meeting_promotions` for that tenant is skipped — no second
    proposal.
13. **Rematerialization survival:** delete + re-insert the candidate row with the SAME
    content-derived id (reproducing `server.py`'s behaviour), re-run ingest → still zero new
    proposals.
14. A ledger row is written for each proposal created, linking `meeting_record_id` → `proposal_id`.
15. A run with zero new candidates creates the run (or skips it — pin whichever, per reflection.ts's
    early-return shape) and zero proposals, without error.

**GREEN scope.** The read query, the fail-closed map, the ledger check/insert, run minting, and
`createProposal` per candidate. Use `createProposal` from `src/proposals/repository.ts` — never a raw
proposal insert. Model the payload validation on `apply.ts`'s `memoryCreatePayload` zod pattern
(`apply.ts:72`): validate the shape you construct rather than trusting the meeting row.

**REFACTOR.** Keep the candidate→payload mapping a pure function so it is unit-testable apart from
the DB.

**Done when.** All tests green; no direct work-item write exists anywhere in the module (grep-assert
it in review).

---

### Task B.3 — `POST /api/agent/meeting-ingest` (Clerk-authed, tenant-scoped)

**Goal.** The ingest is reachable from the app, scoped to the caller's tenants.

**Files.**
- Create `apps/platform-api/src/routes/meeting-ingest.ts` + `meeting-ingest.test.ts`
- Modify `apps/platform-api/src/app.ts`

**RED — test list.**
1. An unauthenticated request is rejected (the standard auth middleware path).
2. The route resolves tenants via `callerTenantIds(sql, claims)` — modelled on
   `routes/agent-reflection.ts:100`.
3. A caller ingesting a tenant they do not belong to is refused — no cross-tenant ingest.
4. A successful call returns a summary: proposals created, candidates skipped-as-duplicate,
   candidates skipped-as-unmapped-tenant. (The unmapped count must be *visible*, not silently zero —
   that is how a fail-closed map stays debuggable.)
5. Mounted at `/api/agent/meeting-ingest` in `app.ts`, beside the other agent routes.
6. **No cron/schedule registration exists** for this route in this slice — assert the absence.

**GREEN scope.** A thin route: auth → `callerTenantIds` → call `runMeetingIngest` → summary JSON.
No business logic in the route.

**Done when.** Route tests green; `app.ts` mounts it; platform-api suite green.

---

## Slice C — honest nav

### Task C.1 — Remove the three stub meeting nav entries and their dead routes

**Goal.** No nav row points at a placeholder, and no fake counts remain.

**Files.**
- Modify `apps/platform-web/src/shell/boards.ts`
- Modify `apps/platform-web/src/shell/boards.test.ts`
- Modify `apps/platform-web/src/router.tsx`
- Modify `apps/platform-web/src/shell/Sidebar.test.tsx` (assertions referencing removed rows)

**RED — test list.**
1. The meeting board declares exactly `all-meetings` and `triage-queue` — the keys `this-week`,
   `action-items`, `jobs`, and the `processing` section header are **absent**.
2. No meeting nav item carries a hardcoded `count` (today: `action-items: 4`, `triage-queue: 2`,
   `jobs: 1` at `boards.ts:185-220`). A count must come from data or not exist.
3. The routes `meetings/week`, `meetings/actions`, `meetings/jobs` no longer exist in `router.tsx`.
4. `resolveScreen` still resolves the surviving meeting rows (no collateral damage).

**GREEN scope.** Delete the three rows + section header, the three route definitions, and any
now-unused lucide imports (`Calendar`, `Cpu`, and `ListChecks`/`Inbox` if unused after the edit).

**Done when.** platform-web unit tests green; no dead route resolves to `BoardScreen` under
`meetings/`.

---

### Task C.2 — The real meeting-triage screen

**Goal.** `meetings/triage` lists real meeting action items with their true promotion state.

**Files.**
- Create `apps/platform-web/src/boards/meetings/MeetingTriageScreen.tsx` + `.test.tsx`
- Create `apps/platform-web/src/data/meeting-actions/` (types, network repository, fixtures + tests)
- Modify `apps/platform-web/src/router.tsx` (point `meetings/triage` at the real screen)
- Add the backing read endpoint in platform-api if B.3's summary is insufficient (a tenant-scoped
  list of candidates + their ledger/proposal state)

**RED — test list.**
1. Renders each candidate's text and its promotion state: **unpromoted** / **proposal pending** /
   **accepted → work item**.
2. An accepted candidate renders a link to its work item; a pending one renders a link to the Inbox.
3. The four states render correctly: loading skeleton, empty (`EmptyState`), error (`ErrorState`),
   ready — mirroring `InboxScreen.tsx`.
4. The repository is an optional prop defaulting to the shared singleton (the `InboxScreen` seam), so
   tests drive a fixture store.
5. The network repository normalizes unknown promotion states rather than rendering junk (the
   `network-repository.ts` `normalizeSource` pattern at :4-11).
6. Candidates are tenant-scoped — the repository never requests across tenants.

**GREEN scope.** Screen + data layer following the `InboxScreen` model. Design-system components from
`@product-suite/ui`; no new visual vocabulary.

**Done when.** Screen tests green; the route renders real data; no fixture leaks into the shipped path.

---

### Task C.3 — "Sync now" + Inbox deep-link

**Goal.** A human can trigger the ingest and land directly on the resulting proposal.

**Files.**
- Modify `apps/platform-web/src/boards/meetings/MeetingTriageScreen.tsx` + test
- Modify the meeting-actions repository (add the ingest mutation)

**RED — test list.**
1. A **"Sync now"** button POSTs `/api/agent/meeting-ingest` exactly once per click.
2. While in flight the button is disabled — no double-ingest from a double-click.
3. On success the list refetches and newly-proposed candidates show **proposal pending**.
4. On failure an error is surfaced (not swallowed) and the list is unchanged.
5. A pending candidate's link targets `/w/$workspace/inbox?proposal=<id>` — the exact parameter
   `InboxScreen` reads (`useSearch({from: "/w/$workspace/inbox"})`).
6. A candidate with no proposal renders no Inbox link.

**GREEN scope.** The mutation + button + link wiring. Depends on B.3 for the real endpoint.

**Done when.** Tests green; clicking Sync in the running app produces proposals in the Inbox.

---

## E2E verification

### Task E.1 — `meeting-loop.spec.ts`: seed → ingest → Inbox → accept → workboard

**Goal.** One spec proves the whole loop against a real backend. This is the definition of done for
the plan.

**Files.**
- Create `apps/platform-web/e2e/meeting-loop.spec.ts`
- Modify `apps/platform-web/e2e/db-provenance.e2e.ts` (add the meeting-candidate SQL seed helper +
  cleanup)
- Modify `apps/platform-web/e2e/README.md` (required env for the meeting seed)

**RED — test list** (a Playwright spec; RED = it fails before B/C land, for the right reason):
1. **Seed:** insert a `meeting.action_items` row with `record_origin='generated'`,
   `review_status='promoted'`, a unique content-derived id and a unique title per run (the
   `Date.now()` suffix pattern `moat-loop.spec.ts` uses so re-runs stay genuine creates), for the
   mapped pilot tenant.
2. **Ingest:** trigger it — via the triage screen's "Sync now" (preferred: it exercises C.3) with the
   endpoint as the fallback path.
3. **Inbox:** the proposal appears in the pending list
   (`getByRole("list", { name: "Pending proposals" })`) and the detail pane shows the candidate text.
4. **Accept:** `getByRole("button", { name: "Accept" })` → the "View item →" link appears.
5. **Workboard:** the item is visible on `/w/$workspace/workboard`.
6. **Persisted provenance:** read Neon directly — `work_items.applied_from_proposal_id` equals the
   accepted proposal's id (reuse `readWorkItemAppliedFrom` from `db-provenance.e2e.ts`), and the item
   carries meeting provenance (`source='meeting'` if Task B.2's test 11 established it persists,
   else the proposal's `context_ref` → the seeded meeting record id).
7. **Idempotence:** a second ingest with the row unchanged adds no second proposal (the ledger,
   proven end-to-end rather than only in unit tests).
8. **Cleanup:** the seeded meeting row and ledger row are removed so re-runs start clean.

**GREEN scope.** The spec + seed/cleanup helpers. Local mode, real Neon, Clerk testing token via
`setupClerkTestingToken` in `beforeEach` (as `moat-loop.spec.ts` does). Soft-skip the direct-DB
assertions when the DB URL is absent, matching the existing provenance helper's behaviour.

**Done when.** The spec passes locally against real Neon, and its selectors are verified against the
live app (not assumed) — the discipline `moat-loop.spec.ts` documents in its header.
