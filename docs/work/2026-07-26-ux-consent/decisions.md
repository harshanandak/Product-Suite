# Decisions — P0 consent bugs in the Review Inbox (2026-07-26)

Source of truth: `docs/research/2026-07-26-ux-audit-and-simplification.md`, findings
**F5** and **F6** ("S0 — Lies in the UI"). Kernel issues:

- F6 → `accept-can-apply-a-496d0f55` — *Accept can apply a DIFFERENT proposal than the deep-link named, with no notice*
- F5 → `the-accept-time-diff-2ef40a29` — *The accept-time diff silently re-bases — the preview is not what the agent proposed*
- Epic → `ux-truth-one-disposal-eadf80c6`; staleness epic → `proposal-staleness-conflict-semantics-a41345b4`

Both bugs share one failure mode: **a human approves something other than what they
were shown.** Every decision below is judged against that, not against effort.

---

## Bug 1 (F6) — a dead deep-link put a DIFFERENT proposal under Accept

### What was wrong

`InboxScreen.tsx` resolved `?proposal=<id>` by *filtering* the pending list and then
falling through to `setSelectedId(current => current ?? proposals[0]?.id)`. An id that
did not resolve therefore selected **the first pending proposal**, with its Accept
button live and no notice. The chat panel's "Review in Inbox →" links carry exactly
these ids, so following one after someone else disposed of that proposal put an
unrelated pending change under the reviewer's Accept.

### Decision 1.1 — an unresolvable id selects NOTHING, and says which of two things happened

The pane renders an explicit notice instead of a proposal, and the pending list stays
beside it (the list *is* the way onward). Three states, because they are three
different facts:

| State | Copy | Why it is its own state |
| --- | --- | --- |
| `checking` | (nothing yet) | We do not know yet, so we must not claim either answer. |
| `disposed` | "That proposal was already accepted / rejected / is no longer pending" | The **common real case** — a teammate or a second tab handled it. |
| `missing` | "That proposal doesn't exist" | A mistyped or stale link. |

An `applied` proposal with a `target_id` also offers **View item →** — the honest path
onward, since the change the link referred to really did land somewhere.

### Decision 1.2 — the distinction needs a by-id read, so the seam grew one method

`GET /api/agent/proposals` returns **pending only**, so "already disposed" and "never
existed" are indistinguishable from the list alone. Rather than guess with vaguer copy,
added:

- `GET /api/agent/proposals/:id` — one proposal in ANY status, tenant-scoped, 404
  otherwise. A malformed id 404s *before* querying, because binding a slug to a `uuid`
  column raises `22P02` and would surface as a 500 ("not found" is the truthful answer).
- `ProposalRepository.get(id): Promise<Proposal | null>` — required, not optional. An
  optional method would silently degrade the consent message on any adapter that
  skipped it, which is the class of bug being fixed.
- `useProposals().getProposal(id)` — a read; it never touches the list.

In the network adapter, **404 resolves to `null` while any other non-OK throws**, so a
500 can never be reported to the reviewer as "that proposal doesn't exist".

### Decision 1.3 — the fallback-to-first-row is not deleted, it is gated on consent

Clicking a row (or "Show pending proposals") clears the notice and *then* the default
selection runs. Same code path, but now a human chose it. That is the whole difference
between the bug and the fix.

### Decision 1.4 — a ref, not just state, guards the default selection

The resolution effect and the default-selection effect run in **one commit**, so
`setDeepLink(...)` from the first is invisible to the second's closure — it selected the
first row anyway, reproducing the bug with the notice rendered *behind* it. A
synchronously-set `deepLinkPendingRef` guards the default selection; the state drives
rendering. Both are updated through one `clearDeepLink()` so they cannot diverge.

Also gated the whole resolution on `isLoading`: before the first load, `proposals` is
`[]`, and reading that as "your proposal is absent" would flash a false not-found notice
on every deep-link.

### Decision 1.5 — a just-disposed proposal must NOT flip to the notice

The pane deliberately keeps a disposed proposal on screen for its terminal
"Applied → View item" banner (via `seenRef`). The resolution effect only ever fires for
an id it has not already honored (`appliedRequestRef`), so accepting a deep-linked
proposal leaves the banner intact instead of replacing it with "already accepted".

### RED → GREEN

RED (`InboxScreen.test.tsx`, 3 new/rewritten specs — 3 failed | 13 passed):

```
Tests  3 failed | 13 passed (16)
 ❯ shows a not-found notice and selects NOTHING when the deep-linked id is unknown
 ❯ says a deep-linked proposal was already disposed of, distinctly from unknown
 ❯ selects the first pending row only when the reviewer explicitly asks
```

The rewritten spec is the load-bearing one: the previous suite asserted
`"falls back to the first proposal when the deep-linked id is not pending"` — the bug
encoded as intended behaviour.

GREEN: `Tests 16 passed (16)`; plus `repository.test.ts` / `network-repository.test.ts`
/ `routes/proposals.test.ts` coverage for the new seam and endpoint. Whole-suite:
platform-web `1048 passed`, platform-api `566 passed | 24 skipped`.

---

## Bug 2 (F5) — the accept-time diff re-based, and the `stale` UI was unreachable

### What was wrong

(a) `buildFieldRows(proposal, target)` read the "before" side of the diff from the
**live** work item, so the preview re-based whenever the target moved. Observed in the
audit: after one proposal applied, a second proposal's diff mutated from
`Seed item (pre-existing) → …` to `UXAUDIT-TMP stale-probe → …`.

(b) `ProposalDetail.tsx`'s `stale` branch was dead: `apply.ts` was last-writer-wins
("proactive staleness detection is deferred"), so a proposal seeded with
`target_version: 999` against a live item applied anyway.

They are one bug: nothing recorded what the proposal was authored against, so neither
the diff nor the write could tell whether the world had moved.

### Decision 2.1 — a schema addition WAS required, and it is one nullable column

`proposals.target_snapshot jsonb` (migration `0017_proposal_target_snapshot.sql`,
journal idx 17). Investigated the alternatives first:

| Candidate | Verdict |
| --- | --- |
| `target_version` (exists) | Compares against nothing — `work_items` has **no version column**, and `updateWorkItem` explicitly must not add one. `expectedVersion` is a documented no-op. |
| `applied_write` / `payloadToPersist` | Written at **accept** time. The before-image has to exist from **draft** time; by accept the state is already live state. |
| Snapshot inside `payload` under a reserved key | `payload`/`edited_payload` are applied WHOLESALE by the API. Smuggling a non-payload key into the thing being written is worse than a column. |
| Reconstruct from the provenance write-log | Fragile, and a read of history to answer a question one column answers directly. |

So: minimal, additive, nullable. NULL = unknown before-state, which renders as unknown
and applies unfenced — every pre-0017 proposal behaves exactly as it did.

Snapshot semantics: **only the fields the payload touches** (`undoableKeys`), read
through Postgres's own `to_jsonb(work_items)`. That rendering matters — it is what the
accept-time fence compares against, and a driver-decoded `Date` would false-conflict on
every item with a due date (the same trap `undo.ts` already documents).

### Decision 2.2 — captured inside `createProposal`, not at each call site

Three paths draft proposals (`agent/tools.ts`, `agent/reflection.ts`,
`meeting/ingest.ts`) and more will follow. A caller that forgot the snapshot would
silently reintroduce the re-basing diff, so the capture lives in the one insert they
all share. It is best-effort by design: a failed read logs and yields NULL, because
drafting the proposal matters more than diffing it perfectly.

### Decision 2.3 — the diff NEVER reads live state again (a structural guarantee)

`buildFieldRows(proposal)` lost its `target` parameter. It cannot read live state now —
the invariant is enforced by the signature, not by a comment. With no snapshot, every
payload field shows an em-dash "current" (the existing, already-tested unknown-target
rendering): "we don't know the before-state" is honest; substituting current state is
not.

The header follows the same rule with a sharper edge: `describeOperation` names the item
from the **snapshot's** title when the payload touches `title` (a rename proposal cannot
re-title its own header from live state), and only otherwise from the live target —
where the proposal makes no claim about the title, the current name is the only one
available and asserts nothing about the change.

### Decision 2.4 — (b): IMPLEMENT staleness detection (chosen), not delete the UI

Chose implementation, and it turned out cheap because the mechanism already existed:
`updateWorkItem` has a working, tested `expectedValues` compare-and-set fence
(`to_jsonb(work_items) @> $fence`) that throws `DomainError('guard_failed')` — built for
undo, unused by accept. The snapshot is exactly the right fence value, so one column
buys both halves of the fix:

1. **Fast path** (step 3b of `applyProposal`): the pre-image read now also returns
   `to_jsonb(work_items)`; comparing it to the snapshot yields the **precise drifted
   field list**, returned as `stale` with a message that names what moved. No write.
2. **Authority**: that same snapshot is passed as `expectedValues`, so a writer landing
   between the check and the write is caught (`guard_failed` → `stale`) instead of being
   clobbered by the accept that just refused to clobber. Checked-then-written is not
   good enough for a consent guarantee.

`classifyWriteFailure` maps `guard_failed` alongside `stale`/`conflict`. The proposal
stays `pending` in every case, so the previously-dead `stale` branch in
`ProposalDetail.tsx:359-367` is now genuinely reachable — the UI stopped lying by the
system becoming true, which is the outcome the brief asked for.

**Why the message must name fields:** with (a) fixed, the pane deliberately shows the
authored-against state, so the reviewer has no other view of what drifted. Naming the
fields is what keeps Refresh / Discard / Apply-anyway meaningful choices.

### Decision 2.5 — no `force` flag, because the existing copy already promised only a try

"Apply anyway" re-attempts; the fence re-runs. The banner already read *"will **try** to
apply the agent's original — the server may still decline it if the conflict stands"*,
which is now literally what happens. A genuine override (knowingly overwriting a named
later edit) is a separate product decision, and inventing it here to satisfy a button
would have been scope creep in the direction of *less* safety. Corrected the stale
"Refresh re-bases" copy and the `TODO(lane-A-rebase)` comments that described the
now-rejected live-diff design.

### Decision 2.6 — shared field helpers moved to a leaf module

`undoableKeys` / `fieldSnapshot` / `conflictingFields` / `normalizeFieldValue` lived in
`undo.ts`, which imports `repository.ts`. Draft-time capture needs them in
`repository.ts` → import cycle. Moved to `proposals/work-item-fields.ts` (imports
nothing local) and re-exported from `undo.ts` so every existing importer and its tests
are untouched. Same normalization on all three paths (draft, accept, undo) is now
structural rather than coincidental.

### RED → GREEN

RED — web (`field-diff.test.ts` + `ProposalDetail.test.tsx`), 8 failed | 51 passed:

```
 × (update) renders the AUTHORED-AGAINST before-state even after the target changed underneath
 × (update) treats an absent snapshot as an UNKNOWN before-state, never live state
 × reads the before-side from the AUTHORED-AGAINST snapshot, never from live state
 × names the item as the proposal saw it when the proposal RENAMES it
 × shows current → proposed for ONLY the changed fields            (+3 more re-based specs)
```

The first one is the F5(a) reproduction: snapshot `title: "Seed item (pre-existing)"`,
live item renamed to `UXAUDIT-TMP stale-probe` — the audit's exact scenario.

RED — api (`apply.test.ts` + `repository.test.ts`), 4 failed | 45 passed:

```
 × captures the target’s CURRENT values for the payload fields on a work_item update
 × passes the snapshot as the compare-and-set fence when the baseline still holds
 × DECLINES a drifted baseline as stale — no write, still pending, names what moved
 × reports a fence lost in the race (guard_failed) as stale, not as a bad payload
   AssertionError: expected { status: 'applied' } to match object { status: 'stale' }   ← F5(b)
```

GREEN: web `1052 passed (106 files)`, api `573 passed | 24 skipped`, db `16 passed`,
migration parity check passed, `tsc --noEmit` clean on web/api/db, `eslint src` clean on
platform-web.

---

## Deliberately NOT done (filed, not smuggled in)

- **The memory-supersede diff has the same re-basing flaw.**
  `buildMemorySupersedeRows(proposal, target)` reads the live memory through
  `useMemories().get`. F5 is about work items and the snapshot column only covers
  `work_item:update`; extending capture to memory targets is the same pattern applied to
  a different table. Filed as `memory-supersede-diff-re-3877095b` (P1) rather than bundled.
- **`expectedVersion` is now a dead forward-seam.** With staleness expressed as a value
  fence, the threaded `expectedVersion` no-op earns nothing. It asserts no guarantee to
  users (its comment is honest about being inert), so removing it is cleanup, not this
  PR's payload. Filed as `remove-the-dead-expectedversion-690f2c9a` (P3).
- **Drizzle meta snapshots.** `packages/db/migrations/meta/` stops at `0011_snapshot.json`;
  0012–0016 shipped SQL + journal only, and the parity gate checks journal↔SQL. 0017
  follows that precedent (hand-authored, no snapshot) rather than regenerating a broken
  chain from a worktree that cannot resolve `drizzle-orm`.
## Deployment prerequisite — 0017 MUST be applied

**This code requires its migration.** Reads degrade safely (a row without
`target_snapshot` is the NULL path: unknown before-state, unfenced apply), but the
INSERT does not: `createProposal` names `"target_snapshot"` in the column list whenever
it captures one, so on a database without 0017 every `work_item:update` proposal draft
would fail with `column "target_snapshot" does not exist`.

That is stated rather than engineered around — a defensive "retry the insert without the
column" would be a workaround needing a paragraph to defend, and it would hide exactly
the drift that should be fixed. The drift is already tracked:
`deploy-pipeline-never-runs-9256d8e4` (the pipeline never runs migrations; the shared DB
is 13 behind) and `migration-0016-memory-ownership-7d54921f`. **0017 must be applied
before or with this merge.**

**Not verified against a live database** — every API test drives a mocked `sql`, so the
`to_jsonb(work_items) @> $fence` containment and the snapshot round-trip are proven by
construction and by the existing undo path that already uses them, not by execution
against Postgres.
