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
