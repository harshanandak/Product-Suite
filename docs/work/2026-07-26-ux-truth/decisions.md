# Decisions — truth-in-UI fixes (UX audit F1, F3, F4)

Source of truth: `docs/research/2026-07-26-ux-audit-and-simplification.md`, section
"S0 — Lies in the UI" (findings F1, F3, F4) and its ranked plan items 1 and 14.

Everything below follows one rule: **the UI may only assert what its inputs
support.** Where the data cannot carry a claim, the claim is removed rather than
softened.

---

## F1 — the pending badge decorated a dead row

### The bug (and why PR #143 did not close it)

`shell/boards.ts` had TWO home rows for one concept: `Review queue → /review`
(a `BoardScreen` placeholder that renders "… — coming soon") and
`Chat → /inbox` (the real `InboxScreen`). `buildHomeItems()` attached the live
pending count to the **`review`** key — the dead row. PR #143 correctly removed a
hardcoded `count: 4` literal, but wired the live number to the placeholder, so
the lie changed shape: the number became true and its destination stayed false.
`TopBar` compounded it — its bell also pointed at `/review`, and the count badge
sat on the **"Ask agent"** button, which opens the chat panel. No badge-bearing
affordance navigated to the queue it counted.

### Decision 1 — vocabulary: **"Review inbox"**

The product used three names for one concept (audit §3): "Review queue" (the dead
nav row), "Review inbox" (the destination screen's own `h1`), "Pending review"
(the chat panel's section). Picked **"Review inbox"**, now used on the rail row,
the TopBar bell (`aria-label`/`title`), and — unchanged — the destination heading.

Why not "Review queue", which Rank 1 suggests? The heading lives in
`InboxScreen.tsx:178`, which a parallel agent owns and this PR must not touch.
"Review queue" would therefore have shipped a row whose label still disagreed
with its destination — the same class of defect being fixed. "Review inbox" is
the only option that makes row, badge affordance, and heading agree **today**,
and it is the name the working surface already carries. "Pending review" was
rejected: it names a state, not a place, so it cannot title a nav row.

Not renamed: the historical design artifacts (`docs/design/*.html`,
`docs/plans/ui-revamp-plan-2026-06-11.md`) still say "Review queue", and the chat
panel's section still says "Pending review". Both are follow-ups — the first is a
doc sweep, the second is the shared-disposal-control work of Rank 3. Neither is a
UI claim the data contradicts, so neither blocks this PR.

### Decision 2 — the orphan `/review` route: **deleted**

Two options were on the table: delete the `/review` placeholder, or mount the
queue at `/review` and retire the "Chat" row.

Deleting is the smaller honest change. Mounting the queue at `/review` would mean
moving `InboxScreen` and its `?proposal=<id>` deep-link (the chat panel's "Review
in Inbox →" target) onto a new path — `router.tsx`'s proposal param is owned by a
parallel agent, the deep link is live, and the move buys nothing: the path is not
what was lying, the row was. So `/inbox` stays the queue's home, one row points
at it, and the placeholder route is gone.

`/review` is now unrouted (falls through to the root `notFoundComponent`) and
`deriveActiveBoard` returns `null` for it, so it cannot resolve to a board and
render a rail around nothing. No redirect was added: `/review` never rendered
anything a user could have bookmarked on purpose.

The "Chat" row is deleted outright rather than renamed — the chat panel is a
TopBar affordance, not a board screen, so it has no rail row to own.

### Decision 3 — the TopBar count moves to the bell

The bell (which navigates to the queue) now carries the badge; "Ask agent" no
longer does. This kills the duplicate count and satisfies the invariant the tests
now enforce: the count and the affordance that navigates to what it counts are
the same element's concern.

### Out of scope, flagged not fixed

The `Digest` row (`/w/$workspace` → `BoardScreen`) is also a nav row that renders
"coming soon". It is the home board's entry route and needs a Digest screen built,
not a truth fix — a feature, not a lie about data. Filed as a follow-up rather
than papered over here.

---

## F3 — the Memory screen implied a comparison with an empty control arm

`MemoryImpactCard`'s `insufficient` branch said "Measuring how much memory
helps…" and "Comparing 5 proposals with memory and 0 without, so far." With a
zero-length arm there is no comparison and nothing is being measured.

Decision: branch on the **arm counts**, not only on the server's `verdict`. When
either arm is empty, the card states plainly that measurement has not started and
reports the real per-arm counts, without the word "comparing" and without
implying a measurement is under way. With both arms non-empty the existing
`insufficient` copy is unchanged (it is then true: a comparison exists, it is just
not yet conclusive).

The card keeps deriving everything from `impact`; no new data is required, and
`verdict === "helps" | "hurts"` cannot be reached with an empty arm without the
server contradicting itself — asserted in tests.

## F4 — a confidence figure asserted from zero evidence

"Confidence 0.91 from 0 transcript reference(s)" is not UI copy. It is baked into
the proposal rationale by `apps/platform-api/src/meeting/ingest.ts`
(`buildRationale`), and that rationale is what the memory card renders as its
body — which is why the string appears verbatim, twice.

Decision: fix the **generator**, not the renderer. `buildRationale` now emits the
confidence sentence only when the candidate carries at least one evidence ref;
with zero refs the sentence is omitted entirely (the figure is not softened,
hedged, or shown as "unevidenced" — a number with no evidence behind it is not
information). String-munging the sentence back out at render time was rejected:
the rationale is prose, and a UI that edits prose it did not write is a second
bug waiting to happen.

Known limit: rows written **before** this change keep their stored rationale
text. Fixing those needs a data migration over `proposals.rationale` and the
memory bodies derived from it — filed as a follow-up, not smuggled into this PR.
