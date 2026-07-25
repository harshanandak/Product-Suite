# Tasks — meeting → board end-to-end loop

Design: [`plan.md`](./plan.md) · Kernel issue `end-to-end-meeting-0c1a2ac1` · Branch `feat/meeting-e2e-loop`

Each task runs the `/dev` TDD loop: **RED** (write the failing test, show it fail) → **GREEN**
(minimal implementation, show it pass) → **REFACTOR** (clean while green), then spec + quality review.

**11 tasks planned; 8 live.** Task 0.1's reality check **cancelled A.1** and made **A.4 and A.5
moot** — see Task 0.1 for the evidence. With them go both **[NEEDS USER GO]** prod-write gates: no
task below mutates hosted infrastructure.

## Dependency graph

```text
0.1 ──┬─► A.2 ──► A.3        (A.1 CANCELLED · A.4, A.5 MOOT — Task 0.1)
      │
      ├─► B.1 ──► B.2 ──► B.3 ──┐
      │                         ├─► E.1
      └─► C.1 ──► C.2 ──► C.3 ──┘
```

Edges that matter:

- **B.1 does not wait for Slice A.** The dedup ledger is a platform-schema migration in Neon; it
  touches nothing meeting-side.
- **B.2 has no Slice-A dependency left.** The meeting tables are already in Neon's `public` schema
  (Task 0.1), so B.2's real-DB tests seed and read `public.action_items` directly. It never depended
  on A.4/A.5 (the hosted cutover), and A.1 — the schema it was waiting for — is cancelled.
- **C.1–C.3 are fully parallel** to A and B until C.3's "Sync now" needs B.3's endpoint to exist for
  its integration test; C.1 and C.2 have no cross-slice dependency at all.
- **E.1 requires B.3 + C-slice routes + the Neon-resident meeting tables** (already present in
  `public`). It does *not* require any hosted repoint — it runs against local + real Neon.

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

**OUTCOME — done 2026-07-24.** The scout's read-only, evidence-cited verdict (TASK-0 VERDICT comment
on kernel issue `end-to-end-meeting-0c1a2ac1`) landed *outside* the three branches this task
anticipated, and it simplifies Slice A out of existence:

1. **The meeting tables are already live in the shared Neon `public` schema** — all 11 present, with
   `alembic_version` stamped at `0005`. Neon is not missing the schema; it never lost it.
2. **PR20's Supabase cutover never completed.** PR20 is `Status: dev`, its smoke gate never passed,
   the Supabase legacy keys were disabled 2025-12-29, and no Supabase connection string exists in any
   config. There is no Supabase source to migrate *from*.
3. **Tenancy is already physically unified.** `public.tenants` is shared by the meeting FKs and by
   `work_items`/`projects`; `work_items.tenant_id` is TEXT. No TEXT→uuid bridge is needed.
4. **No hosted meeting service exists.** Railway meeting-api and Vercel meeting-web both 404 — no
   live users, nothing to repoint.
5. **Data:** 2 stale test meetings (2026-04-14), 0 extraction rows.

**Consequences, recorded on the issue and applied to the tasks below:**

- **A.1 CANCELLED** — nothing to create. The `meeting`-schema migration is not written; `0015` is
  taken by B.1's ledger (see D1 in [`decisions.md`](./decisions.md)).
- **A.4 MOOT** — nothing to apply.
- **A.5 MOOT** — no service to repoint. Both **[NEEDS USER GO]** gates dissolve.
- **A.2 and A.3 still ship** — the preflight and smoke are now vendor-neutral tooling for whatever
  target Postgres a future cutover names, not steps in a Supabase→Neon move.
- **B.2 retargets `public.action_items`** (same database, same `sql` client). The tenant allowlist
  stays, still fail-closed, but maps no id shapes.

**Scout caveat, carried forward:** Supabase emptiness is a high-confidence inference from the
disabled keys, not an observed row count.

**Done when.** ✅ `decisions.md` and this task list record the verdict, and the kernel issue carries
the TASK-0 VERDICT comment.

---

## Slice A — cut the meeting DB back to Neon

### Task A.1 — Neon `meeting` schema migration — **CANCELLED (Task 0.1)**

**Not implemented, and must not be.** The meeting tables are **already live in Neon's `public`
schema** (all 11, `alembic_version` at `0005` — Task 0.1). There is no schema to create, and writing
one now would either duplicate live tables into a second `meeting` schema or collide with them.

**Do not create `packages/db/migrations/0015_meeting_schema.sql`.** `0015` is taken by B.1's
`0015_meeting_promotions.sql`; the Drizzle journal is a contiguous `0..N` sequence, so a reserved-but-
unwritten number would keep `check-migration-parity` red (D1 in [`decisions.md`](./decisions.md)).

**What replaces it.** Nothing in this plan. Modelling the meeting tables in Drizzle is I5's job in the
rewrite epic (`91612c3f`), and it is now an in-database refactor of tables that already sit beside
`teams`/`work_items` — which was Slice A's whole objective.

**Downstream.** B.2 reads `public.action_items` directly; see the dependency graph above.

---

### Task A.2 — Make the cutover preflight direction-agnostic

**Goal.** The preflight runs in either direction without forking the script — source and target
schemas, connection slots and provider labels are all parameters, no vendor is hardcoded.

**Still shipped after Task 0.1.** The reverse cutover it was written for is moot, but a
direction-agnostic preflight is the reusable half: it is the readiness check for *any* future move of
the meeting tables, including I5's.

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
6. The archived report names the **caller's** vendors, not hardcoded ones: a reverse run records
   `source.provider: "supabase"` / `target.provider: "neon"`, and an unset provider records
   `unspecified` rather than defaulting to the forward pair. (Added in review — see D5.)

**GREEN scope.** Parameterise both `schemaName` arguments in `runPreflight` (defaults preserving the
current forward direction, so no existing caller changes) and thread them from env/CLI, together with
the connection slots (`MEETING_PREFLIGHT_SOURCE_DATABASE_URL` / `..._TARGET_DATABASE_URL`) and the
provider labels (`MEETING_PREFLIGHT_SOURCE_PROVIDER` / `..._TARGET_PROVIDER`). Nothing else.

**REFACTOR.** No copy of the table list; `MEETING_SOURCE_TABLES` stays the single source.

**Done when.** `bun test test/meeting-cutover-preflight.test.js` green; the forward direction still
works with default arguments.

---

### Task A.3 — Generalise the create/read smoke to any target Postgres + reverse runbook

**Goal.** The same smoke test proves the Neon target; the runbook documents the reverse cutover and
rollback.

**Files.**
- Rename `apps/meeting-api/tests/backend/test_supabase_create_read_smoke.py` →
  `apps/meeting-api/tests/backend/test_target_db_create_read_smoke.py` (shipped), plus its sibling
  `test_target_db_smoke_config.py` (see D6)
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

### Task A.4 — Apply the `meeting` schema to Neon — **MOOT (Task 0.1)**

Nothing to apply: the meeting tables are already in Neon's `public` schema, and A.1's migration is
cancelled. No `docs/deployment/meeting-neon-preflight.json` is produced, because there is no source
database to preflight *from* — PR20's Supabase project was never populated and its keys are disabled.

The **[NEEDS USER GO]** gate this task carried is withdrawn: there is no DDL write and no data copy.
If a future move of the meeting tables is ever decided, A.2's direction-agnostic preflight and A.3's
target-agnostic smoke are the tooling for it — and it needs its own plan and its own approval, not
this cancelled one.

---

### Task A.5 — Repoint meeting-api `DATABASE_URL` to Neon — **MOOT (Task 0.1)**

No service to repoint: hosted meeting-api (Railway) and meeting-web (Vercel) both 404, and there are
no live users. `DATABASE_URL` already points at Neon wherever meeting-api runs (locally).

The second **[NEEDS USER GO]** gate is withdrawn with it. Hosting for the meeting service is an open
question owned by the rewrite epic (`91612c3f`) — until it is answered, extraction runs locally only.
`docs/deployment/SERVICE_INVENTORY.md` needs no edit from this plan.

---

## Slice B — the promote bridge

### Task B.1 — `meeting_promotions` dedup ledger

**Goal.** A platform-schema table that records which meeting record ids have already been proposed,
keyed to survive meeting-api's delete/re-insert rematerialization.

**Files.**
- Modify `packages/db/src/schema.ts`
- Create `packages/db/migrations/0015_meeting_promotions.sql` + a `_journal.json` entry at `idx: 15`.
  **No `meta/00NN_snapshot.json`** — the snapshot chain stops at `0011` and `0012`–`0014` each shipped
  hand-authored SQL without one; regenerating it is a filed repo-wide chore, not this task's payload
  (D1 and D2 in [`decisions.md`](./decisions.md))
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

**Goal.** A pure-ish module that turns promoted meeting action items into pending proposals, exactly
once each. **Depends on B.1** (the ledger) only — A.1 is cancelled, so the read target is
`public.action_items` in the shared Neon database, reached with the platform's own `sql` handle
(Task 0.1). Every `meeting.action_items` reference below means `public.action_items`.

**Files.**
- Create `apps/platform-api/src/meeting/ingest.ts`
- Create `apps/platform-api/src/meeting/ingest.test.ts`
- Create `apps/platform-api/src/meeting/tenant-map.ts` + `tenant-map.test.ts`

**RED — test list.**

*Tenant map (pure, unit) — after Task 0.1 this is an **allowlist**, not a translation:
`public.tenants` is already shared by the meeting FKs and by `work_items`/`projects`, so a meeting
`tenant_id` IS the platform tenant id. The fail-closed gate stays; only the id-shape change goes:*
1. A configured meeting tenant id resolves to the platform tenant id it already equals.
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
1. **Seed:** insert a `public.action_items` row with `record_origin='generated'`,
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
