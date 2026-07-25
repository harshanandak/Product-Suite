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

## D5 — The preflight report names its own direction *and* its vendors (Task A.2)

**Context.** `runPreflight` built a report with `source.provider: "neon"` and
`target.provider: "supabase"` hardcoded, and the URL parameters were named
`neonDatabaseUrl` / `supabaseDatabaseUrl`. In the reverse direction those names
are backwards: the "neon" slot carries the Supabase source URL.

**Decision, as first shipped.** Added `source.schema` / `target.schema` to the
report (with a test). Deferred the provider labels and the URL parameters as a
follow-up, on the grounds that renaming them was caller-visible and outside A.2's
stated scope.

**Superseded in PR review (2026-07-25).** CodeRabbit flagged the deferral as
shipping *wrong* archived evidence, not merely incomplete evidence — a reverse
report would assert `neon → supabase` for a run that was `supabase → neon`. That
is correct, and a deferral cannot make it safe. The fix landed here instead:

- The URL parameters are `sourceDatabaseUrl` / `targetDatabaseUrl`, from
  `MEETING_PREFLIGHT_SOURCE_DATABASE_URL` / `..._TARGET_DATABASE_URL`. The slots
  are now named for their role, so nothing is inverted to reason about.
- `sourceProvider` / `targetProvider` are caller-supplied
  (`MEETING_PREFLIGHT_SOURCE_PROVIDER` / `..._TARGET_PROVIDER`) and default to
  `unspecified`. **A report never guesses a vendor**: absent evidence reads as
  absent rather than as the forward direction.
- The two vendor-named failure codes went with them:
  `SUPABASE_TARGET_TABLES_MISSING` → `TARGET_TABLES_MISSING`,
  `SUPABASE_EXTENSIONS_MISSING` → `TARGET_EXTENSIONS_MISSING`. Same defect: a
  reverse run whose Neon target is missing tables must not blame Supabase.

Both runbook env blocks name the providers explicitly, and the docs test asserts
the reverse block reverses them. The forward direction is unaffected apart from
requiring the operator to state the vendors it used — which is the point.

**Why not keep the old env names as aliases.** Nothing sets them: the Supabase
cutover never completed and no config in the repo carries a Supabase connection
string (Task 0.1). A back-compat path with no caller is dead code.

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

## D8 — Task A.1 CANCELLED: the meeting tables already live in Neon `public` (Task A.1)

**What happened.** A.1 (`0016_meeting_schema.sql`, porting the Supabase `meeting`
schema into the Drizzle chain) was implemented, green, and committed as `83261fc`.
Task 0's reality check then landed and invalidated its premise. The commit is
**reverted**, not amended around.

**The verified reality** (read-only `information_schema` query against the live
Neon platform DB via `.dev.vars`):

- Schemas present: `drizzle`, `neon_auth`, `public`. **There is no `meeting`
  schema and no need for one.**
- `public.action_items`, `public.meetings`, `public.decisions`,
  `public.open_questions`, `public.chapter_summaries`,
  `public.transcript_segments` all already exist — alongside `work_items`,
  `proposals`, `agent_runs`, `meeting_promotions`, `tenants`, `teams`, `users`.
- `public.tenants` is ALREADY the shared tenant table both sides FK into.
- Row counts: `action_items` 0, `meetings` 2 (stale test data), `tenants` 3.

The Supabase cutover never completed and that project is dead, so the schema this
migration was porting *from* was never the live shape.

**Consequence.** A.1 is cancelled; **A.4 and A.5 are MOOT** — there is nothing to
apply and no live Railway meeting-api to repoint. B.2 retargets from
`meeting.action_items` to `public.action_items` (see D14).

**What survives the revert.** Nothing depends on the reverted migration: B.1's
`meeting_promotions` ledger is a `public`-schema table and untouched, and A.2/A.3
parameterised the preflight/smoke by *schema name*, which reads `public` as
happily as `meeting`.

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

## D12 — Where `skippedUnmappedTenant` comes from (Task B.2) — **SUPERSEDED by D23**

> The cross-tenant count described below leaked other tenants' promoted volume and has
> been removed. Read **D23** for what ships; this entry is kept as the record of the
> reasoning that was wrong.

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

---

## D14 — B.2 reads `public.action_items`, verified from the live DB (Task B.2)

Following D8, the ingest query is retargeted from `meeting.action_items` to the
unqualified `action_items` in the platform `public` schema — the same schema the
rest of the codebase reads (`from "proposals"`, `from work_items`).

**The column set was verified, not assumed.** A read-only `information_schema`
query against the live Neon database returned all 17 columns of
`public.action_items`: `id`, `tenant_id`, `meeting_id` (all `text not null`),
`chapter_summary_id`, `"text" text not null`, `status` (default `'open'`),
`owner_user_id`, `due_at`, `evidence_refs jsonb not null default '[]'`,
`record_origin` (default `'generated'`), `review_status` (default `'draft'`),
`created_at`, `updated_at`, `confidence double precision not null default 0`,
`promotion_reason`, `source_window_start`, `source_window_end`. This matches the
Alembic history, so the seven columns the ingest selects are all present.

**`"text"` must be quoted** in the select list and in the seed inserts — it is both
a column name here and a Postgres type name.

**Contract-tier consequence.** `meetings` and `action_items` are Alembic-owned, so
the Drizzle journal the db-contract harness replays does not create them — exactly
like `tenants` and `users`, for which the harness already installs stand-ins. The
suite now creates its own stand-ins for those two, transcribed from the verified
live shape, so a drift between them fails a seed here instead of surprising
production.

---

## D15 — The tenant map is an ALLOWLIST, and neither side may be uuid-validated (Task B.2)

Two changes fell out of D8, both caught by checking the live database rather than
by reasoning from the plan.

**1. Its job changed from translation to authorization.** Meeting rows and the
board already share `public.tenants`, so the configured map is normally
*identity* (`{"<tenant>": "<tenant>"}`). That makes it an allowlist of which
tenants have opted into meeting ingest. It is deliberately KEPT rather than
collapsed into a passthrough: fail-closed behaviour is the whole point (an
unlisted tenant is refused, never defaulted), and enabling a tenant stays a config
change rather than a code change. The test suite pins identity-plus-refusal
explicitly so nobody later "simplifies" it into a passthrough.

**2. The uuid validation was a real bug, now fixed.** `parseMeetingTenantMap`
originally required the mapped platform id to match a uuid regex. Live
`public.tenants` holds **`org_3GjXPnun3ZpummWvuvNS2vnXwFf`** — a Clerk org id —
alongside two uuids, and it is one of only two tenants that has any `work_items`
at all. The uuid check would therefore have silently refused the main tenant with
board data: a fail-closed module failing closed on everything. Both sides are now
validated as non-empty TEXT, which is what the columns are. A test covers the
Clerk-org-id shape so the regex cannot come back.

---

## D16 — C.2 needed a new READ endpoint; the ingest summary could not back a list (Task C.2)

Task C.2 left this open ("add the backing read endpoint if B.3's summary is
insufficient"). It is insufficient: B.3 returns *counts* from a write, so a screen
built on it could only show what the last sync did, not what exists. Added
`GET /api/agent/meeting-candidates` (`routes/meeting-candidates.ts` +
`meeting/candidates.ts`) as a separate route — a different verb on a different
resource, and conflating them would put an idempotent read on a write's path.

The join uses **two different tenant keys**, which is the subtle part:
`action_items.tenant_id` is the MEETING tenant (filtered through the allowlist's
mapped ids), while `meeting_promotions.tenant_id` / `proposals.tenant_id` /
`work_items.tenant_id` are the PLATFORM tenant (what the ingest wrote). Under D15's
identity allowlist these coincide; joining on the wrong one would silently report
every candidate as unpromoted the moment they diverge.

The org-anchoring logic B.3 had inline moved to `meeting/request-scope.ts` and is
now shared by both routes. If they disagreed on which tenant a request acts for,
the screen would list one org's candidates while "Sync now" ingested another's.

## D17 — A FOURTH promotion state, `dismissed`, beyond the three the task named (Task C.2)

The task named three states (unpromoted / proposal pending / accepted). The data
has a fourth: a human who rejected the proposal. Rendering that as "proposal
pending" would report the opposite of their decision back to them, and inviting a
re-propose is exactly the harm. `derivePromotionState` maps the terminal proposal
statuses (`rejected`/`superseded`/`expired`/`failed`) to `dismissed`.

It also prefers what was **written** over what was intended: an existing
`work_items` row means `accepted` whatever the proposal's status column says.

Client-side, `normalizePromotionState` folds anything else to **`unknown`** —
deliberately not `unpromoted`, because a state from a newer backend has still been
acted on, and defaulting it to "nothing happened yet" would invite re-proposing
handled work. An `unknown` row renders a neutral badge and NO link: we do not know
where it points.

## D18 — The triage screen needs its own provider, or the shipped page shows fixtures (Task C.2)

`useMeetingActions` resolves injected prop → context → module singleton, and the
singleton is the MOCK (mirroring `getDefaultProposalRepository`). So without a
provider the real page would silently render invented meeting items. Added
`MeetingActionsRepositoryProvider` (network by default, fixtures only behind the
compile-time `USE_FIXTURES` branch) and mounted it in BOTH `AppRoot` trees, with a
test per branch — that test is the only thing standing between a shipped page and
fixture data.

## D19 — "Sync now" guards the double-click with a REF, not the disabled attribute (Task C.3)

The task asks for one POST per click and a disabled button in flight. `disabled`
alone does not deliver that: it is applied on the next React render, so two clicks
dispatched in the same tick both pass the check and both ingest. `useMeetingActions.sync`
therefore flips a `syncingRef` **synchronously** and returns early if it is already
set; `isSyncing` drives the visible disabled state. The test clicks twice — once
while in flight — and asserts `sync` was called exactly once.

The ingest is idempotent server-side via the promotion ledger, so a slipped double
click would not corrupt anything. It would still mint a second `agent_runs` row and
waste a round trip, and "disabled in flight" is not honest if the guard is cosmetic.

## D20 — A failed sync shows BESIDE the list; only a successful one refetches (Task C.3)

`syncError` is separate state from `error`. The load error replaces the screen (there
is nothing to show); a sync error must not, because the ingest wrote nothing and the
list the user is reading is still correct. Rendering `ErrorState` there would overstate
the damage and lose their place.

For the same reason the failure path does NOT refetch — re-reading after a write that
did nothing is pure noise. Only success bumps the reload key. A later successful sync
clears the error, so a stale banner can never sit above a sync that worked.

## D21 — Sync now renders on the EMPTY state too (Task C.3)

The task lists Sync alongside the candidate list, which reads as "part of the ready
state". Implemented across both: with zero candidates a sync is the ONLY way to get
any, so gating the button behind a non-empty list would make the empty state a dead
end — the exact position a first-time pilot tenant is in. The header (title, count,
Sync) renders for empty and non-empty alike; only the body swaps between `EmptyState`
and the list.

## D22 — Client sends no `org_id`, so a MULTI-org caller gets 400 on both meeting routes

Neither the read nor the sync sends an org id — scope comes from the verified Clerk
token, and a client-supplied tenant id would be a request to be trusted about
identity (the same stance as the proposals adapter). The consequence, inherited from
B.3's `resolveMeetingAnchor`: a caller who belongs to **two or more** orgs gets
`400 Ambiguous organization; specify org_id` from both endpoints, because the client
never names one. Single-org callers — the pilot shape — are unaffected.

This is a real limitation, not a defect in the anchoring logic (refusing to guess
which org to write to is correct). Resolving it needs the screen to pass the ACTIVE
org, which means deciding what the `$workspace` route param maps to — out of scope
for C.3 and filed as kernel issue **`c3c60c5b`** rather than guessed at here.

---

## D23 — D12 SUPERSEDED: the unmapped *count* leaked other tenants' volume (PR #148 review)

**D12 claimed "a number leaks nothing across tenants". That was wrong**, and CodeRabbit
was right to flag it. `countUnmappedCandidates` counted promoted+generated
`action_items` rows *outside* the caller's allowed meeting tenants and returned the
figure to the caller as `skippedUnmappedTenant`. Two consequences:

- **The degenerate case was the bad one.** With no allowed meeting tenants the
  exclusion clause was empty, so the query counted **every promoted row system-wide**.
  Any org member whose tenant is simply not in the allowlist could call the endpoint
  and read the total volume of promoted candidates across every other tenant.
- Even when allowlisted, the count included rows belonging to *other, legitimately
  mapped* tenants — so it both leaked their volume and misreported them as "unmapped".

**Decision.** The cross-tenant query is **deleted**, not narrowed. B.3 test 4's real
requirement — a fail-closed map must not be silent — is met by a new caller-scoped
field, `tenantAllowlisted: boolean`, false when the caller's platform tenant has no
entry in the map. That is a fact about the caller's OWN configuration, so reporting it
discloses nothing, and it answers "why did no proposals appear" more directly than a
count the caller could not act on. An operator-facing `console.warn` names the tenant.

`skippedUnmappedTenant` survives with a narrower, honest meaning: the D10 in-code
re-check only, counted over rows the caller's own scoped read returned. Structurally
near-zero — which is the point, since it is now a defence-in-depth signal rather than
a survey of the database.

**Cheaper, too.** The ingest no longer aggregates over `action_items` at all; the unit
harness now *throws* on any `count(` against that table so the leak cannot return.

---

## D24 — The ingest dedups sequential runs, NOT concurrent ones (known gap, filed)

CodeRabbit correctly found that `createProposal` runs before the ledger write, so two
simultaneous ingests both pass the ledger read, both insert a proposal, and only one
wins `meeting_promotions`' unique index — the loser's proposal survives as a duplicate
pending row (`proposals.context_ref` has no unique index).

**Not fixed in this PR, and not papered over.** Both textbook fixes are blocked:
reserving the ledger row first is impossible while `proposal_id` is `NOT NULL` with an
immediate FK to a proposal that does not yet exist, and Neon's HTTP driver has no
interactive transaction to roll the proposal back (`provenance/record-write.ts:16`).
The three viable designs — a single-statement CTE, a nullable `proposal_id` with
reclaim logic, or a partial unique index on `proposals` — each need a schema or writer
change, which is not a thing to improvise in a review round.

**Filed as kernel issue `714225a1`** with the mechanism, the blocked fixes, and the
three designs. What this PR does change is the **comment that claimed the unique index
already decided the winner** — it did not, and a comment promising a guarantee the code
does not provide is worse than the gap itself.

Bounded on purpose: human-triggered endpoint, no cron, the button guards the
double-click (D19), and the surplus row is a *pending* proposal a reviewer rejects —
propose-only means no work item is created either way.
