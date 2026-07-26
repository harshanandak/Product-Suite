# UX audit + simplification plan — the shipped Product Suite

Date: 2026-07-26
Author: UX audit pass (agent), worktree `.worktrees/meeting-integration`, branch `feat/meeting-e2e-loop`
Status: research + design deliverable. **No product code was changed.**

---

## 0. How this was produced (so you can trust or re-run it)

Driven against the **real running app**: Vite dev server on `:5173`, `wrangler dev`
platform-API on `:8787`, real Clerk test session (the `global.setup.e2e.ts` testing-token
pattern), real Neon database, real OpenRouter agent.

- **45 screenshots** in `docs/research/ux-audit-shots/` (untracked).
- Two capture passes: `_phase-a-report.json` (every routed surface in its natural
  state, plus forced loading/error states via `page.route` interception) and
  `_phase-b-report.json` (five **seeded pending proposals** driving the populated
  queue and every disposal outcome).
- Every screenshot was inspected, and each surface's rendered text/headings/buttons
  captured programmatically so a blank frame is detectable rather than assumed-fine.

**Two corrections to the audit brief, up front:**

1. `e2e/db-provenance.e2e.ts` contains **no seed or cleanup helpers** — only one
   read probe, `readWorkItemAppliedFrom()`. Seeding and cleanup were written from
   scratch for this audit.
2. The briefed "meetings triage screen with Not proposed / Proposal pending /
   Accepted" **does not exist in the shipped app.** Those three strings appear
   nowhere in `apps/`, `packages/`, or `services/`. `/meetings` and
   `/meetings/triage` both render the generic `BoardScreen` placeholder. So the
   product does not have three review pipelines in the UI — it has **two shipped
   (chat proposals and memory proposals, both landing in the Inbox) plus a third
   that exists only in the database** (`meeting_promotions` joins
   `meeting_record_id` → `proposal_id`; 0 rows). This materially changes Phase 2's
   question, and for the better: unification is still cheap.

---

## 1. The state map a user actually traverses

### 1a. Routed surfaces (`apps/platform-web/src/router.tsx`)

| Route | Renders | Real or placeholder |
| --- | --- | --- |
| `/w/:ws` (Digest) | `BoardScreen` | **placeholder** — "Digest — coming soon" |
| `/w/:ws/review` ("Review queue") | `BoardScreen` | **placeholder** — "Review queue — coming soon" |
| `/w/:ws/inbox` ("Chat" in nav) | `InboxScreen` | **real — this is the Review Inbox** |
| `/w/:ws/memory` | `MemoryScreen` | real (no nav entry anywhere) |
| `/w/:ws/workboard` | `WorkboardIndexRoute` | real, populated |
| `/w/:ws/workboard/views` | `WorkboardViewsScreen` | real, empty |
| `/w/:ws/workboard/item/:id` | `WorkItemDetailScreen` | real |
| `/w/:ws/projects` | `ProjectsRoute` | real, empty |
| `/w/:ws/meetings`, `/meetings/triage` | `BoardScreen` | **placeholder** |
| `/w/:ws/canvas{,/starred,/shared}` | `BoardScreen` | **placeholder** |
| `/w/:ws/settings` | `SettingsScreen` | real, but "Coming soon" ×2 inside |
| unknown in-shell path | TanStack default | bare "Not Found" — the crafted `notFoundComponent` never renders |

**8 of 16 routes are the same "coming soon" placeholder.** The dock advertises four
boards (Home / Workboard / Meeting board / Canvas); two of those four are entirely
placeholder.

### 1b. The proposal state machine (as the user meets it)

```
                    ┌──────────────────────────────────────────┐
   agent chat ──────┤  proposal (status='pending')              │
   (Ask agent)      │  DB: proposals.status                     │
   autonomous run ──┤                                           │
   [meetings: DB    └───┬──────────────────────────┬────────────┘
    seam only, 0 rows]  │                          │
                        │                          │
        ┌───────────────▼──────────┐   ┌───────────▼────────────────┐
        │ SURFACE A: chat panel     │   │ SURFACE B: Review Inbox    │
        │ "Pending review · N"      │   │ "Review inbox · N pending" │
        │ actions: Accept /Edit /   │   │ actions: Accept / Reject   │
        │          Discard          │   │ (+ reason chips)           │
        └───────────────┬──────────┘   └───────────┬────────────────┘
                        └──────────┬───────────────┘
                                   ▼
              ┌────────────────────────────────────────────┐
              │ accept → AcceptResult envelope (LOCKED)     │
              │  applied | invalid | stale | failed |       │
              │  not_found | not_pending                    │
              └───┬──────────┬────────┬──────────┬──────────┘
                  │          │        │          │
             "Applied.   "Rejected." "This    stale/invalid/failed
              View item→  (terminal)  proposal  → StatusBanner
              [Undo]"                 is no      + Retry
             (Undo ONLY for            longer   ** UNREACHABLE:
              work_item update)        available" the backend never
                  │                               emits `stale` **
                  ▼
        work_items row written
        (applied_from_proposal_id set, actor_type='agent',
         run_id set, on_behalf_of = approver)
                  │
                  ▼
        ***  UI shows "Source: Manual"  ***
        ***  Activity tab: "No activity yet"  ***
```

**Terminal states with no forward path:** `rejected`, `gone`, `undone` — each
prints one sentence and leaves the user on a disposed item while the list beside
it has already dropped that row. No auto-advance and no "Next →".
(`InboxScreen.tsx:63-66` documents this as deliberate: keep the banner visible
rather than jump. Defensible, but it means every disposal costs a manual click.)

**Disposal vocabulary, per surface, for the same underlying act:**

| Concept | Chat panel | Review Inbox | Home nav | Memory screen | DB |
| --- | --- | --- | --- | --- | --- |
| the queue | "Pending review" | "Review inbox" / "N pending" | "Review queue" | — | `status='pending'` |
| approve | **Accept** | **Accept** | — | — | `applied` |
| decline | **Discard** | **Reject** | — | **Retract** | `rejected` |
| amend | **Edit** | *(absent)* | — | **Supersede** | `supersede` |
| postpone | *(absent)* | *(absent)* | — | **Defer** | `defer` |

Four words for "decline" across four surfaces. `Edit` exists in chat but not the
Inbox; `Defer` exists on the Memory screen but not in the Inbox that is supposed
to be the single place proposals are disposed of.

---

## 2. Findings

Severity: **S0 = the UI asserts something the data does not support** (trust
damage), S1 = blocks or badly slows the core loop, S2 = friction, S3 = polish.

### S0 — Lies in the UI. Fix these first.

**F1. The pending-count badge sits on a "coming soon" page; the real queue is labelled "Chat".**
`shell/boards.ts:132-162`. `HOME_STATIC_ITEMS` maps `Review queue → /w/$ws/review`
(a `BoardScreen` placeholder) and `Chat → /w/$ws/inbox` (the actual `InboxScreen`).
`buildHomeItems()` then attaches the live pending count **to the `review` key** —
the dead row. With 5 pending proposals seeded, the sidebar reads "Review queue **5**"
and clicking it says "Review queue — coming soon".
The second "5" renders on the TopBar **"Ask agent"** button, which opens the chat
panel — so **no badge-bearing affordance anywhere navigates to the queue it counts.**
The code comment above `buildHomeItems` reasons carefully about not lying with a
stale literal, and it doesn't — it decorates the wrong row instead.
→ `ux-audit-shots/SEEDED-review-route-with-badge.png`,
  `SEEDED-home-rail-with-badge.png`, `inbox-natural.png` (active row = "Chat").

**F2. Agent-authored work items claim `Source: Manual`.**
Verified in data: 4 of the 5 work items in the e2e tenant have
`applied_from_proposal_id` set, `actor_type='agent'`, and a `run_id` — and **all 5
have `source='manual'`**. `WorkItemDetailScreen.tsx:467` renders
`<ProvenanceChip source={row.source} />`, so every agent-created item is labelled
as human work, on both the detail page and the workboard's Source column. There is
**no provenance module at all**: nothing links an item back to the proposal that
created it, nobody is named as the approver, and the Activity tab says "No activity
yet" for an item an agent had just renamed via an accepted proposal.
This is the moat's central claim ("agent proposes, human disposes, durably
attributed") being contradicted on the surface where a skeptical user goes to check.
→ `SEEDED-accepted-item-detail-provenance.png`, `SEEDED-workboard-after-accept.png`.

**F3. The Memory screen reports a measurement it cannot have.**
"Measuring how much memory helps — the number appears once there's enough evidence
to be sure. **Comparing 5 proposals with memory and 0 without, so far.**" A holdout
comparison with an empty control arm is not a comparison; the copy implies
measurement is under way when nothing is being measured.
→ `memory.png`.

**F4. "Confidence 0.91 from 0 transcript reference(s)."**
A precise confidence asserted from zero evidence, rendered verbatim, twice.
→ `memory.png`.

**F5. The `stale` / needs-attention state can never occur.**
I seeded an update proposal with `target_version: 999` against a live item. It
**applied anyway** — "Applied. View item → Undo". `proposals/apply.ts` says so
explicitly: writes are "last-writer-wins; proactive staleness detection is deferred".
So `ProposalDetail.tsx:359-367`'s whole `stale` branch is unreachable, and two
proposals touching one item silently overwrite each other with no warning.
Worse: because the diff's "before" side is read **live from the target**, the
displayed diff silently re-bases. After my first proposal applied, the second
proposal's diff mutated from `Seed item (pre-existing) → …` to
`UXAUDIT-TMP stale-probe → …`. **The user is shown a "what will change" preview
that is not what the agent proposed.**
→ `SEEDED-accept-result-stale-probe.png`, `SEEDED-inbox-after-disposals.png`.

**F6. A dead proposal deep-link silently selects a different proposal.**
`/inbox?proposal=<nonexistent-uuid>` renders the **first** pending proposal with
its Accept button live and no notice that the requested one wasn't found
(`router.tsx:88-89` keeps any string; `InboxScreen.tsx:85` falls back to
`proposals[0]`). The chat panel's "Review in Inbox →" links carry exactly these
ids, so a link followed after someone else disposed of that proposal puts a
**different** pending change under the user's Accept button.
→ `SEEDED-inbox-bogus-deeplink.png`.

**F7. Accepting a work-item proposal silently creates an unreviewed memory titled with the agent's rationale.**
Not a rendering bug — a pipeline surprise found during cleanup. Two `decision`
memories appeared titled *"Three separate customer calls this week named the pricing
page as the reason they stalled."* and *"Probe for the stale/needs-attention
envelope."* — verbatim `rationale` strings from the proposals I accepted. One
approval produced a second durable artifact, in a different store, that the user
never saw or approved, with a rationale sentence as its title.

### S1 — The queue is slower than the work it gates

**F8. Non-`create` proposals are titled with raw UUIDs in the list.**
"Update 1a2bf0d4-1f71-4a…", "Supersede 148af253-…". Two different update proposals
rendered as **visually identical rows**. The detail pane resolves the name properly
("Update Seed item (pre-existing): 2 fields"), so the data is available — the list
just doesn't use it. A queue you cannot scan cannot be triaged.
→ `SEEDED-inbox-populated.png`.

**F9. Zero keyboard support in the Inbox.**
No `onKeyDown`, no arrow/`j`/`k`, no accept/reject shortcut anywhere in
`boards/inbox/*.tsx`. Rows are `<button>`s so Tab works, but the primary review
loop is mouse-only. Every comparable product makes this keyboard-first.

**F10. "What will change" is expressed in database columns for creates.**
A `create` renders a `FIELDS` dump: `type feature`, `team_id
b8c0af20-cd25-456d-8200-748b7cf04ad9`, `status_id 3d309ada-…`. The user is asked to
approve a write described in snake_case column names and foreign-key UUIDs. An
`update`, by contrast, gets a genuine `old → new` diff. Same surface, two standards.
→ `SEEDED-detail-work-item-create.png` vs `SEEDED-detail-work-item-update.png`.

**F11. No snooze/defer, no batch action, no partial accept.**
Accept and Reject are the only exits. A proposal you can't judge now stays pending
forever and keeps the badge lit. `defer` is already in the memory operation
vocabulary and on the Memory screen — just not in the Inbox.

**F12. Accepting a `create` is irreversible with nothing offered.**
Undo is correctly shown for work-item **updates** (`Applied. View item → Undo`),
but a `create` accept has no reverse path — not even "delete the item I just made".

### S2 — Friction and inconsistency

**F13. Raw backend error text is rendered to the user.** `Couldn't load proposals /
boom` and `Couldn't load memories / boom` pass `error.message` straight through,
while the workboard shows a generic "Could not load work items". → `inbox-error.png`,
`memory-error.png`, `workboard-error.png`.

**F14. A failed work-items fetch deletes the TEAMS section from the sidebar.**
Compare `workboard-populated.png` ("My items Views Projects **TEAMS General**") with
`workboard-error.png` ("My items Views Projects"). Navigation vanishes because a
data call failed.

**F15. The empty Inbox loses its own identity.** Populated, the surface has a
"Review inbox · N pending" header and All/Chat/Autonomous/Connector facets. Empty,
the header and facets are gone — just a dashed box in a void, on a page whose nav
row says "Chat". A user who lands here cannot tell what surface they're on.
→ `inbox-natural.png`.

**F16. Source facets can filter the list to nothing with no explanation.** Proposals
with `source = null` (all five of mine, and anything the backend omits) appear only
under "All". Selecting Chat/Autonomous/Connector empties the list silently.

**F17. `/projects` and `/memory` swap the sidebar from Workboard to Home.**
`deriveActiveBoard` (`boards.ts:290-303`) has no case for `projects` or `memory`, so
both return `null` and fall back to the Home rail — even though **Projects is a
Workboard rail row**. This directly violates the navigation law asserted in that
file's own header comment ("Navigating to any screen WITHIN a board never mutates
the sidebar"). → `projects.png`.

**F18. The Decision Log has no navigation entry at all.** No sidebar row, no dock
icon, and no `⌘K` "Boards" entry — the palette lists only Home / Workboard / Meeting
board / Canvas board / Settings. Reachable only by URL or the `⌘K` action "Log a
decision". The Review Inbox is likewise absent from the palette by name.
→ `memory.png`, `command-palette.png`.

**F19. Red means two different things.** In the Inbox, `Reject` is red and sits
co-equal with green `Accept` — but rejecting destroys nothing. On the Memory screen,
the loudest button on the page is the destructive `Retract`. → `SEEDED-inbox-populated.png`, `memory.png`.

**F20. Confidence is a bare model number.** `0.86` and `0.42` get identical
treatment; nothing tells the reviewer that one deserves scrutiny.

### S3 — Polish

**F21.** In-shell unknown routes render a bare "Not Found" — the designed
`notFoundComponent` (EmptyState + "Back to Home") is dead code for them.
No escape link. → `notfound-404.png`.
**F22.** The loading skeleton is three full-width bars; the loaded layout is
list + detail pane. Guaranteed layout shift. → `inbox-loading.png`.
**F23.** Memory cards print `by 225db228-42ea-…` / `logged by eaa8538e-…` — raw
UUIDs as author identity — and repeat the title verbatim as the body.
**F24.** Work-item detail duplicates Type/Status/Priority/Health as both chips
under the title and rows in the PROPERTIES rail. `Dependencies 0` is a dead number
with no affordance.
**F25.** Settings shows three connector cards (Gmail/Slack/Google Drive) that read
as available integrations under a "Coming soon" label.
**F26.** The agent's own prose leaks ids: *"…for the General team
(b8c0af20-cd25-456d-8200-748b7cf04ad9)"*. → `SEEDED-agent-chat-proposal-produced.png`.
**F27.** Inbox list titles truncate at ~30 chars while ~30% of the viewport width
sits empty to the right and most of the page height is unused.

---

## 3. Phase 2 answer: one experience, or several that rhyme?

**They rhyme. They are not one experience** — but the gap is narrower than feared,
because the meeting pipeline has no UI yet. Concretely:

1. **Two surfaces dispose of the same object with different verbs and different
   powers.** The chat panel offers Accept / **Edit** / **Discard**; the Inbox offers
   Accept / **Reject** (+ reason chips). `Edit` exists only in chat. Reason chips
   exist only in the Inbox. A user who wants to amend a proposal must use chat; a
   user who wants to record *why* they declined must use the Inbox. Same proposal,
   two half-experiences.
2. **The nav names a third thing.** "Review queue" (dead) vs "Review inbox" (the
   heading) vs "Pending review" (chat). Three names, and the one in the primary
   nav is the one that doesn't work.
3. **Memory proposals are the better-designed half of the *same* screen.**
   The memory detail pane reads "Log a decision: '…'", renders the body as prose,
   labels "Why proposed:", and shows human values (`kind decision`, `topics infra,
   database`). The work-item pane on the same screen dumps `team_id` UUIDs. The
   quality difference is per-target-type, inside one component.
4. **The accept moment does not close the loop.** You learn *that* it applied
   ("Applied. View item →"); you do not learn what the resulting object looks like,
   who it is attributed to, or — because of F2 — you learn something false when you
   follow the link.
5. **The one genuinely unified thing is the data model,** and it's good: one
   `proposals` table, one `AcceptResult` envelope, one `target_type` discriminator,
   `meeting_promotions` already pointing at `proposal_id`. The incoherence is
   entirely in the presentation layer. That is the cheap kind of problem.

**Where a user must switch surfaces to finish one thought:** ask the agent
(chat panel) → it proposes → to see the diff properly you go to the Inbox → accept →
to check what happened you go to the work item → which tells you a human did it.
Three surfaces and one falsehood for one intention.

---

## 4. Inspiration, cited

Labelled `[verified]` = read in the primary source this pass; `[reasoning]` = my
inference from it.

**Linear — Triage** ([linear.app/docs/triage](https://linear.app/docs/triage)) `[verified]`
- Four disposals, not two: *"accept with `1`, mark as duplicate with `2`, decline
  with `3`, or snooze with `H`"*. Number keys, single keystroke.
- *"Declining will … present the option of adding a comment with an explanation."*
  (We already do this well with reason chips — keep it.)
- *"Snoozing will hide the issue from the triage queue to return at a time of your
  choosing, **or when there's new activity on that issue: whichever comes first**."*
- Navigation by shortcut: *"Navigate to Triage with `G` then `T`"* — the queue is a
  first-class destination with a dedicated key.
- **Transferable pattern:** a review queue is fast because *every* exit is one
  keystroke and because "not now" is a real, self-returning exit — not an item left
  pending forever. → attacks F9, F11.

**GitHub — reviewing a pull request**
([docs.github.com](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)) `[verified]`
- *"After reviewing a file, mark it as **Viewed** to collapse it and track your
  progress. The **progress bar** in the pull request header shows how many files
  you've viewed."*
- **The staleness pattern we need, exactly:** *"If the file changes after you view
  the file, **it will be unmarked as viewed**."* Review state is invalidated by
  the target moving.
- Rationale-first review: the sidebar's linked issues exist so a reviewer can
  *"understand the motivation"* before judging.
- **Transferable pattern:** a structured review shows (a) progress through the set
  and (b) automatic invalidation when the thing under review moves. → attacks F5,
  and gives F5 a cheap honest fallback.

**Aza Raskin — "Never Use a Warning When you Mean Undo"**
([A List Apart #241](https://alistapart.com/article/neveruseawarning/)) `[verified]`
- *"The solution to our warning woes is undo. … **Never use a warning when you mean
  undo**."* And on Gmail: *"When you delete an e-mail, it immediately gives you an
  option to undo that action."*
- **Transferable pattern:** an inline, immediately-visible Undo at the moment of
  action beats a confirmation step. Our accept path already has a working
  `POST /:id/undo`; the gap is that it's offered for updates only and never as a
  toast. `sonner` is already exported from `packages/ui` — this is a wiring job.
  → attacks F12, and makes F11's batch accept safe.

**GitHub Copilot — accepting suggestions**
([docs.github.com](https://docs.github.com/en/copilot/using-github-copilot/getting-code-suggestions-in-your-ide-with-github-copilot)) `[verified]`
- Tab accepts the whole suggestion; `Ctrl/Cmd+→` accepts **the next word**;
  `Accept Word` is a hover control.
- **Transferable pattern:** granular accept. The unit of approval should be
  selectable, not all-or-nothing. For a *structured* change that means per-field
  accept — take the priority bump, drop the rename. Our `POST /:id/accept` already
  takes `edited_payload`, so the backend supports this today. → attacks F11.

**Linear — Triage Rules** `[verified]` / **Triage Intelligence** `[verified]`
- Rules *"take automated actions on issues when they enter Triage"*; conflicts are
  *"surfaced in the interface"*.
- **Transferable pattern** `[reasoning]`: the long-run answer to queue volume is
  policy (auto-accept low-risk classes), and the honest presentation of policy is to
  show where rules disagree rather than hide it. Relevant to the confidence display
  (F20): a threshold the user sets is more legible than a bare `0.42`.

**Our own design system** (`packages/ui/src/index.ts`, `styles/tokens.css`) `[verified]`
- Already exported and unused for this: **`sonner`** (undo toasts), **`checkbox`**
  (batch select), **`command`** (the palette is already built — adding entries is
  trivial), `skeleton`, `tooltip`, `hover-card`, `separator`, `button-group`.
- Semantic tokens already exist: `--success` (documented as *"the positive twin of
  Reject"*, contrast-tested at 5.05:1), `--destructive`, and the priority/phase
  ramps.
- **Every recommendation below is buildable with these primitives.** No new visual
  language, no new dependency.

---

## 5. Ranked plan (user-visible value ÷ build cost)

Each item is scoped to become a kernel issue. **Group A unifies the pipelines;
Group B polishes one surface.** Ranks interleave the groups by ratio.

### Rank 1 — [A] Point the nav at the queue it counts *(hours)* — fixes F1
Make one row the review queue: label it **"Review queue"**, route it to `/inbox`,
keep the live count badge on it, and delete the `/review` placeholder route (or
redirect it). Rename the current "Chat" row to what it is, or drop it — the chat
panel is a TopBar affordance, not a board screen.
Touches: `shell/boards.ts` (`HOME_STATIC_ITEMS`, `buildHomeItems`, `deriveActiveBoard`),
`router.tsx` (`homeReviewRoute`). Add the queue to `⌘K` (F18) in the same change.
*Highest ratio in the document: the single most-visible falsehood, ~20 lines.*

### Rank 2 — [A] Make provenance visible on the object *(1–2 days)* — fixes F2, F7
A **"How this got here"** module on `WorkItemDetailScreen` and on memory cards:
*"Proposed by agent · model · accepted by <name> · Jul 26 · view the proposal →"*,
read from `applied_from_proposal_id` / `run_id` / `actor_type` / `on_behalf_of`
(all already stored). Stop rendering `Source: Manual` for rows with an
`applied_from_proposal_id` — either fix the write path to set `source='agent'` or
derive the chip from provenance. Write an Activity event on accept so the Activity
tab stops saying "No activity yet" about an agent's edit. Surface F7's
rationale-derived memory as a visible consequence of the accept, or stop creating it.
Draws on: GitHub's rationale-first sidebar; Linear agent attribution.
*This is the moat made legible. Nothing else on this list buys as much trust.*

### Rank 3 — [A] One disposal vocabulary and one action set *(1–2 days)* — fixes the §3 divergence
Pick the words once and use them on both surfaces: **Accept / Reject / Defer**
(drop "Discard"). Give the Inbox the chat panel's **Edit**, give the chat panel the
Inbox's **reason chips**, and add **Defer** to the Inbox (the operation already
exists for memories). Extract the disposal control into one shared component so a
third pipeline — meetings — inherits it for free.
Touches: `agent-chat/ProposalCard.tsx`, `agent-chat/AcceptStateView.tsx`,
`boards/inbox/ProposalDetail.tsx`, `data/proposals/use-proposal-actions.ts`.
Draws on: Linear's four-verb disposal set.

### Rank 4 — [B] Name every row in the queue *(hours)* — fixes F8
Resolve the target's title for `update`/`supersede`/`retract` rows the way the
detail pane already does (`field-diff.ts:proposalListTitle` + the target lookup).
No row should ever be titled with a UUID.
*Tiny change; converts an unscannable list into a scannable one.*

### Rank 5 — [A] Tell the truth about staleness *(1 day, honest version)* — fixes F5
Two parts, and the cheap part is most of the value:
(a) **Stop showing a re-based diff.** Snapshot the target's values at proposal time
and render the diff against *that*, so "what will change" is what the agent
actually proposed.
(b) Compare the snapshot to current on load; when they differ, show the existing
`stale` banner — *"This item changed since the agent proposed it"* — with a refresh
action. This makes the already-built `stale` branch reachable **from the client**,
without waiting on server-side version enforcement.
Draws on: GitHub's *"if the file changes after you view it, it will be unmarked as
viewed"*. File the server-side `target_version` enforcement as a separate issue.

### Rank 6 — [B] Keyboard-first queue *(1–2 days)* — fixes F9, and F12's safety
`J`/`K` or arrows to move, `A` accept, `R` reject, `E` defer, `?` for a shortcut
sheet; accept fires a `sonner` toast with **Undo** (Raskin/Gmail) instead of the
current silent-and-irreversible create. Keep the terminal banner *and* add a
**"Next →"** so the deliberate no-auto-jump decision stops costing a click.
Draws on: Linear's `1`/`2`/`3`/`H`; Raskin on undo. Uses `sonner`, already exported.

### Rank 7 — [B] Describe changes in human terms *(1 day)* — fixes F10, F20, F26
Resolve `team_id`/`status_id`/`assignee_id` to names, and label fields
"Team"/"Status" not `team_id`. Render a `create` as the item card it will become,
not a column dump. Replace bare `0.42` with an interpreted band (High / Medium /
**Low — worth a close look**) keeping the number as a tooltip.
Draws on: Copilot's legible, granular accept surface.

### Rank 8 — [A] Make the Inbox empty state a starting point *(hours)* — fixes F15
Keep the "Review inbox" header and facets when empty, and give the empty state the
**two actions that generate proposals**: "Ask the agent" (opens the chat panel) and
"Log a decision" (`/memory?new`). A user who lands on an empty queue currently has
no path forward at all. Same treatment for the `/projects` zero-state ("Create
project") and Views (which already does this well — copy it).
Draws on: Linear's triage zero-state.

### Rank 9 — [B] Stop leaking backend errors; keep nav stable *(hours)* — fixes F13, F14
Replace `description={error.message}` with a plain-language string plus a
"details" disclosure. Derive the TEAMS rail section from its own query so a
work-items failure can't delete navigation.

### Rank 10 — [A] Fix the deep-link contract *(hours)* — fixes F6
When `?proposal=<id>` is not in the pending list, do **not** silently select
another one: show *"That proposal is no longer pending"* with the queue beside it.
Safety-critical given chat links are the primary entry path.

### Rank 11 — [B] Batch + partial accept *(2–3 days)* — fixes F11
`checkbox` multi-select with "Accept N", and per-field accept for updates via the
`edited_payload` the accept endpoint already takes. Sequence **after** Rank 6 so
undo exists before bulk actions do.
Draws on: Copilot's Accept-Word granularity.

### Rank 12 — [B] Honest placeholders *(1 day)* — fixes F21, F25, and the 8 placeholder routes
"Coming soon" ×8 identical panels reads as a broken app, not a roadmap. Give each
placeholder a specific, dated promise and one thing to do meanwhile ("Meetings
land in <milestone>. Until then, ask the agent about a meeting →"). Render the
designed `notFoundComponent` for in-shell unknown routes so a 404 has an exit.
Consider hiding the Canvas dock icon until it does something.

### Rank 13 — [B] Restore the navigation law *(hours)* — fixes F17, F18
Add `projects` and `memory` cases to `deriveActiveBoard` so Projects keeps the
Workboard rail; give the Decision Log a real rail row (Home) and a `⌘K` Boards entry.

### Rank 14 — [B] Memory card cleanup *(hours)* — fixes F3, F4, F19, F23
Resolve author UUIDs to names; drop the body when it duplicates the title;
de-emphasise `Retract` to match `Reject`'s weight; **delete the holdout banner
until the control arm is non-empty**, and suppress "from 0 transcript reference(s)"
rather than printing it.

### Rank 15 — [B] Layout and skeleton fidelity *(hours)* — fixes F22, F24, F27
Skeleton mirrors the two-column layout; widen the list column; drop the duplicated
chip row on work-item detail or drop the PROPERTIES duplicates; make
`Dependencies 0` a link or remove it.

---

## 6. Explicitly not verified / open

- **Dark mode** was not audited (the toggle exists in the TopBar; every capture is
  light).
- **Responsive / narrow viewports** not audited — all captures are 1440×900.
- **Accessibility** beyond accessible names was not audited (no contrast or
  screen-reader pass); note `--success` is contrast-tested in `packages/ui`.
- **The Digest surface** is a placeholder, so its intended content is unknown; the
  ranked plan does not assume one.
- **Meetings UI**: nothing to audit. `meetings`, `meeting_promotions`,
  `meeting_state`, `action_items`, `open_questions`, `decisions` tables exist;
  `meeting_promotions` has 0 rows and the 2 `meetings` rows belong to the
  `personal` tenant, not the e2e org.
- **The curator verdict** on memory proposals (described in the brief as in
  progress) is not present in this worktree's Inbox — `RuleAttributionBadge` and
  `RuleProposalSurface` exist, but I could not produce a rule proposal to see them,
  so those two components are **uncaptured**.
- **F7's mechanism** is unconfirmed: I observed that accepting work-item proposals
  left memories titled with their `rationale`, but did not trace whether the writer
  is the accept path or a reflection run triggered by it.
- **Whether `source='agent'` is ever written** — every row in this tenant is
  `manual`, so the chip may be correct-but-unreachable rather than wrong. Either
  way the rendered result is false for agent-created items.

## 7. Database hygiene

The shared Neon database is **back to its pre-audit state**: 5 work items (same
ids, titles, priorities), 5 proposals (all `applied`, 0 pending), 2 active memories.

One incident, disclosed: my seeded `target_version: 999` update **applied** (F5) and
renamed the pre-existing item `1a2bf0d4-…` to `UXAUDIT-TMP stale-probe`; my
marker-based cleanup then deleted it by title. I re-inserted the row with its
original id and field values (`Seed item (pre-existing)`, feature/plan/medium,
`source='manual'`, team + status unchanged, `applied_from_proposal_id=null`).
**`created_at` is an approximation** — set to `2026-07-19T18:39:00Z` to preserve its
original first position in `created_at` order; `actor_type` was set to the column
default `'system'`. Nothing referenced the row (0 dependencies, 0 checks). Two stray
memories created from proposal rationale (F7) were also removed.
