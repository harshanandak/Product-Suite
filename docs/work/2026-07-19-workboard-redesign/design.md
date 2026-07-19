# Workboard IA + Agent Surface Redesign — Decisive Proposal

Date: 2026-07-18. Authored against `.superpowers/sdd/workboard-redesign-research.md` (Linear/Huly
patterns) and the current-workboard audit. Verified against the live code in
`apps/platform-web/src/` (shell/boards.ts nav definitions, agent-chat/AgentChatPanel.tsx,
boards/inbox/InboxScreen.tsx, boards/workboard/{table,kanban,graph,detail,toolbar}).

**Frozen ontology (unchanged):** Workspace → Team (owns statuses/cycles) → Item → Task (Item with
parent) / Check (checklist row); Project = optional cross-team container (owns milestones).
**Moat loop (unchanged):** agent proposes → Review Inbox → human accepts. Accept lives ONLY in the Inbox.
**Design system (unchanged):** shadcn/ui, indigo primary, Geist, oklch tokens.

---

## The one-sentence thesis

The workboard's complexity is **breadth, not depth**: 8 sidebar rows where 5 are dead, a view
(Graph) posing as a destination, a whole parallel Agent board, and an ontology the UI mislabels.
The fix is Linear's move — **one Item surface reconfigured by display options, a bounded noun
sidebar, depth shown inline — plus exactly two agent places: the chat panel (talk, everywhere)
and the Inbox (approve, one door).** Everything below is deletion and rewiring first, net-new
UI second.

---

## A. New sidebar / IA

### Kill list (deletions, no replacements needed)

| Row today | Verdict |
|---|---|
| Strategy | **Delete.** Placeholder. If it ever ships, it ships as its own board, not a dead row. |
| Insights | **Delete.** Placeholder. |
| Tasks | **Delete.** Task is an Item with a parent — it surfaces inline in the list and in parent detail (§C). Never a destination. |
| Triage | **Delete.** Placeholder. Re-add later only as a Linear-style opt-in per team, hidden by default. |
| Feedback (+ "Intake" section header) | **Delete.** Placeholder; the section header dies with it. |
| Graph | **Delete as destination.** Graph becomes a **Layout** option on the one Item surface (§B). |

### Final Workboard left-nav (the complete list — nothing else)

```
BEFORE  (8 rows, 5 dead)                 AFTER  (bounded nouns, zero dead rows)
┌──────────────────────────┐             ┌──────────────────────────┐
│ WORKBOARD                │             │ WORKBOARD                │
│                          │             │                          │
│  ▸ Work items            │             │  ◉ My Items              │
│  ▸ Graph                 │             │  ▸ Views                 │
│  ▸ Strategy      (dead)  │             │  ▸ Projects              │
│  ▸ Insights      (dead)  │             │ ── TEAMS ─────────────── │
│  ▸ Tasks         (dead)  │             │  ▾ Sourcing              │
│  ▸ Triage        (dead)  │             │      Items               │
│  INTAKE                  │             │      Cycles*             │
│  ▸ Feedback      (dead)  │             │  ▸ Ops                   │
│                          │             │  ▸ Platform              │
│                          │             │        * opt-in, hidden  │
└──────────────────────────┘             │          until enabled   │
                                         └──────────────────────────┘
```

- **My Items** — the personal cross-team lens (assignee = me). Default landing for the board.
- **Views** — saved display-option combos (§B). Contextual team views also list under each team
  when created there.
- **Projects** — ONE workspace-level page (cross-team by definition, so it adds zero per-team
  weight). List of projects → drill into a light Project overview (§D).
- **Teams section** — one collapsible row per Team. Expands to `Items` (+ `Cycles` only when the
  team enables cycles). That's the whole per-team noun set at launch. This is the ONLY hierarchy
  a user traverses: Workspace → Team → Item.
- Workspace switching stays in the existing corner `WorkspaceSwitcher` — not a nav row.
- The **BoardDock** keeps Home / Workboard / Meeting / Canvas. The **Agent board leaves the dock**
  (§E) — its four rows + "Your agents" section are absorbed, not moved.

### What collapses to lens / inline / detail (the rule, stated once)

Team = the one traversable container. Status, Project, Cycle, Priority, Assignee = **group/filter
dimensions** on the Item surface. Task = **inline nesting + drill-in**. Check = **module inside
Item detail**. Milestone = **field on Item + list inside Project overview**. Graph = **layout**.
Nothing in this paragraph ever gets a nav row.

---

## B. The single primary Item surface + Display options

One screen — `Items` (team-scoped, or cross-team via My Items / a View) — replaces
table/kanban/graph as separate screens. The existing `table`, `kanban`, `graph` components become
**layout renderers behind one toolbar**; `filter-state.ts` grows group/sort/view state.

**Display-options model** (Linear's, on our ontology):

| Control | Options | Default |
|---|---|---|
| **Layout** | List · Board · Graph | List |
| **Group** | Status · Project · Cycle · Priority · Assignee · Team (cross-team scopes) · None | Status |
| **Filter** | Status, Team, Project, Cycle, Priority, Assignee, Label, has-parent | — |
| **Sort** | Manual · Priority · Updated · Created · Due | Updated |
| **Tasks** | Nested · Flat · Hidden (sub-item visibility toggle) | Nested |
| **Save as View** | Names the current Layout×Group×Filter×Sort combo | — |

- "Board grouped by Status" and "List grouped by Cycle" are **the same page in different
  clothes** — no more screen-per-arrangement.
- **Graph is a Layout**, not a place: it renders the current filtered set as the dependency/graph
  view. Same filters, same selection, same detail drill-in. The graph URL redirects here.
- **Timeline: deliberately deferred.** It only earns its slot once Projects carry target dates
  (Phase 4+). Shipping List/Board/Graph is honest to what the data supports today.
- **Views** = saved combos, listed in the sidebar `Views` row (workspace) or under the team where
  created. A View is a bookmark, never a fork of the data.

### Mockup — primary Item surface (List layout, grouped by Status, tasks nested)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Sourcing › Items                                                        [⌘K]  [◔] [＋] │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Layout [List ▾]   Group [Status ▾]   Filter [＋]   Sort [Updated ▾]        [☆ Save view]│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ▾ In Progress ── 3                                                                     │
│ ────────────────────────────────────────────────────────────────────────────────────── │
│  ▾ ITM-142  Vendor onboarding revamp            ▰▰▱ 2/3   ● Proj Atlas   ◐ P1  ⦿ RK   │
│      └ ITM-151  Draft new intake form                     In Progress    ◐ P2  ⦿ RK   │
│      └ ITM-152  Migrate legacy vendor records             Todo           ◐ P2  ⦿ —    │
│    ITM-147  Freight quote comparison sheet                ● Proj Atlas   ◐ P2  ⦿ AN   │
│  ▸ ITM-139  Supplier scorecard v2               ▰▱▱ 1/4                  ◐ P1  ⦿ HS   │
│                                                                                        │
│ ▾ Todo ── 2                                                                            │
│ ────────────────────────────────────────────────────────────────────────────────────── │
│    ITM-155  RFQ template localization                     ○ Cycle 14     ◐ P3  ⦿ —    │
│    ITM-156  Customs duty calculator spike                                ◐ P3  ⦿ AN   │
│                                                                                        │
│ ▸ Done ── 12                                                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
   ▾/▸ on an Item = expand/collapse its Tasks · ▰▰▱ 2/3 = tasks done · row click = detail
```

The right edge stays clean: project chip, cycle chip, priority, assignee — display properties,
toggleable. No per-row buttons; actions live on selection + ⌘K + context menu (shadcn
`DropdownMenu`).

---

## C. Task (sub-item) and Check

**Task — Linear's sub-issue model, exactly (currently zero UI):**

1. **Inline nesting in the list** — parent rows get a disclosure chevron + `▰▰▱ 2/3` progress;
   Tasks indent one level beneath (one level only — the ontology's parent field is one hop).
   The `Tasks: Nested/Flat/Hidden` display option controls visibility.
2. **Created from the parent** — `+ Add task` block in Item detail under the description;
   inline title-entry, Enter to add the next. A Task IS a full Item (own status/assignee/detail),
   it just has a parent.
3. **Drill-in** — clicking a Task opens the same Item detail with a parent breadcrumb
   (`ITM-142 ▸ ITM-151`). No "Tasks" screen anywhere; the filter `has-parent` covers any
   "all tasks" need.

**Check — stays in detail, promoted from buried tab to visible module:**

Checks are the moat's most concrete write target, currently hidden behind the detail page's
Checks tab. Promote them to a **module on the detail overview** (summary-first,
importance-weighted): title → status/properties → description → **Checks** → Tasks → linked
proposals. `Activity` remains a tab. Checks never appear in nav or any list surface.

### Mockup — Item detail (header + module order)

```
┌──────────────────────────────────────────────────────────── ITM-142 ───┐
│ ‹ Sourcing › Items                                  [⋯]  [Ask agent ✦] │
│                                                                        │
│  Vendor onboarding revamp                                              │
│  [● In Progress ▾] [◐ P1 ▾] [⦿ R. Kumar ▾] [● Atlas ▾] [○ Cycle 14 ▾] │
│ ──────────────────────────────────────────────────────────────────────│
│  Rework the vendor intake flow so onboarding completes in <2 days …    │
│                                                                        │
│  CHECKS ─ 2/4                                                          │
│   [x] Legal template approved              [x] Pricing bands confirmed │
│   [ ] Sandbox account provisioned          [ ] GST fields validated    │
│                                                                        │
│  TASKS ─ 2/3                                                           │
│   ● ITM-151  Draft new intake form            In Progress   ⦿ RK      │
│   ○ ITM-152  Migrate legacy vendor records    Todo          ⦿ —       │
│   ＋ Add task                                                          │
│                                                                        │
│  ── Activity ─────────────────────────────── (tab) ────────────────── │
└────────────────────────────────────────────────────────────────────────┘
```

---

## D. Ontology realignment

| Misalignment today | Fix | Net-new UI |
|---|---|---|
| `department` shown as the grouping noun | **Rename + rewire to Team** everywhere (chips, filters, group headers, detail rail). Team becomes the sidebar container (§A). | None — relabel + the Teams sidebar section. |
| `phase` shown where Status belongs | **Rename to Status**; statuses render as team-owned board columns / list group headers. | A minimal **Team settings › Statuses** editor (name, order, category). One small screen — statuses are configured, never browsed. |
| Project has no UI | **Group/filter dimension first** (chip on rows, `Group: Project`), plus the workspace `Projects` page → **light Project overview**: name, lead, target date, progress bar, **Milestones list**, and an embedded Item surface filtered to the project. | Projects list page + overview page (the overview reuses the §B surface for its item list — only the header + milestones strip are new). |
| Cycle has no UI | **Lens first**: `Group: Cycle` + cycle chip + filter. `Cycles` sidebar row is per-team **opt-in, hidden by default** (Linear's move); when enabled, one page listing current/next/past cycles, each opening the Item surface filtered to that cycle. | Cycle chip + group-by (cheap); the opt-in Cycles page (small, later phase). |
| Item Status vs the old phase board | The Board layout's columns ARE the team's statuses — one source of truth. | None beyond the Status editor above. |

Milestones: a field on Items (filter/group later if needed) + the list inside Project overview.
Not top-level, ever — Huly's cautionary tale.

---

## E. Agent interaction model — the decisive call

**Decision: exactly two agent places. The chat panel is where you TALK. The Inbox is where you
APPROVE. The Agent board is retired — absorbed, not moved.**

This is cheaper than it sounds because the skeleton already exists and is already right:
`AgentChatPanel` is mounted app-wide in `ShellLayout.tsx`, `linked-object.ts` already resolves
the current route's object as context, and `ProposalCard` already deep-links "Review in Inbox"
(`?proposal=<id>`, handled by `InboxScreen`). The redesign **promotes this to THE model and
deletes its competition**:

1. **The dockable chat panel = the one conversational surface.**
   - Toggle from anywhere: `⌘J` + a single `✦` button in the TopBar. Docks right (like the
     detail rail), collapses to nothing — zero chrome when closed.
   - **Auto-binds context**: a context chip shows what the agent sees — the open Item on a detail
     page, the current View's filter set on a list, the Project on its overview. Chip is
     pin-able (keep talking about ITM-142 while navigating away) and clearable (workspace scope).
   - Conversation persists across navigation — it's a panel, not a page.

2. **⌘K is the fast lane INTO the same panel — not a second agent.**
   - The palette (today: board-nav only) gains **item search + deep nav** (fixing the audit gap)
     and an **"Ask agent" mode**: press `Tab` (or type `?`) to flip the input into a prompt.
     Submit → opens the panel, pre-bound to the current context, with your prompt as the first
     message. ⌘K stays stateless; the panel owns the conversation. One brain, two doors.

3. **Every agent write is a proposal, and every proposal has ONE door: the Inbox.**
   - The chat panel never grows Accept buttons. Its `ProposalCard` says
     `→ Review in Inbox`, exactly as built. The moat loop is untouched — consolidations
     strengthen it by removing the second approval surface:
   - **`agents/approvals` merges into the Review Inbox.** Two approval queues is a moat leak
     waiting to happen. The Inbox gains a source facet (chat / autonomous run / connector) —
     filters, not tabs-as-places.
   - **`agents` (Runs) → a "Sessions" list inside the chat panel** (clock icon in the panel
     header → past sessions/runs, click to review a transcript). Run history is agent memory,
     not a work destination.
   - **Connectors + agent configuration → Settings › Agents.** Config is plumbing; plumbing
     lives in Settings.
   - **The Agent board leaves the BoardDock.** Four rows + "Your agents" prototype section
     deleted. Net UI change of this whole section: strongly negative.

**Why this reconciles "everywhere + context-aware" with "no added complexity":** every piece of
new capability lands inside chrome that already exists (palette, panel, Inbox, Settings), and an
entire board with 7 nav rows is deleted. The user learns one rule: **talk in the panel, approve
in the Inbox** — and the panel already knows what they're looking at.

### Mockup — ⌘K in "Ask agent" mode

```
        ┌──────────────────────────────────────────────────────────────┐
        │  ✦ Ask agent                                    (Tab ⇄ search)│
        │  ┌────────────────────────────────────────────────────────┐  │
        │  │ break ITM-142 into tasks for the migration work▏       │  │
        │  └────────────────────────────────────────────────────────┘  │
        │  Context  ◉ ITM-142 · Vendor onboarding revamp   [pin] [×]   │
        │  ────────────────────────────────────────────────────────────│
        │  ↵  Send to agent panel        esc  Cancel                   │
        └──────────────────────────────────────────────────────────────┘
```

### Mockup — the docked chat panel, bound to the current Item, proposing → Inbox

```
┌ Workboard ──────────────────────────────────────┬─ ✦ Agent ──────────────┐
│ Sourcing › Items › ITM-142                      │ ◉ ITM-142 Vendor onb…  │
│                                                 │      [pin] [🕘] [×]    │
│  Vendor onboarding revamp                       │────────────────────────│
│  [● In Progress] [◐ P1] [⦿ RK] [● Atlas]        │ You: break this into   │
│                                                 │ tasks for migration    │
│  Rework the vendor intake flow so…              │                        │
│                                                 │ ✦ Based on the descrip-│
│  CHECKS ─ 2/4                                   │ tion and checks, I pro-│
│   [x] Legal template approved                   │ pose 3 tasks:          │
│   [ ] Sandbox account provisioned               │ ┌────────────────────┐ │
│   …                                             │ │ ▲ PROPOSAL         │ │
│  TASKS ─ 2/3                                    │ │ Add 3 Tasks to     │ │
│   ● ITM-151  Draft new intake form              │ │ ITM-142            │ │
│   ○ ITM-152  Migrate legacy records             │ │ · Export mapping   │ │
│   ＋ Add task                                   │ │ · Dry-run import   │ │
│                                                 │ │ · Cutover + verify │ │
│                                                 │ │ [→ Review in Inbox]│ │
│                                                 │ └────────────────────┘ │
│                                                 │┌──────────────────────┐│
│                                                 ││ Message agent…    ↵  ││
└─────────────────────────────────────────────────┴┴──────────────────────┴┘
   ◉ chip = auto-bound route context · 🕘 = Sessions (absorbs the Runs list)
   Accept/Reject exist ONLY in the Inbox (moat loop unchanged)
```

---

## F. Phased build order (each phase shippable alone)

| Phase | Scope | Nature |
|---|---|---|
| **1. Cut + realign** (first — max simplification, least risk) | Delete Strategy/Insights/Tasks/Triage/Feedback rows + Intake header + Graph row (redirect to Items). Rename `department→Team`, `phase→Status` across chips/filters/headers/detail. New sidebar: My Items · Views(stub) · Projects(stub) · Teams section. ⌘K gains item search + open-by-id. | ~90% deletion/rewiring. |
| **2. One surface + display options** | Toolbar (Layout/Group/Filter/Sort/Tasks-toggle) over the existing table+kanban renderers; Graph wired in as a Layout; saved Views land (sidebar `Views` goes live). | Net-new toolbar; renderers reused. |
| **3. Task nesting** | Parent field UI: inline nesting + progress fraction in list, `+ Add task` + Tasks module in detail, parent breadcrumb; Checks promoted from tab to overview module. | Net-new, contained to list rows + detail. |
| **4. Project + Cycle lenses** | Project chip/group/filter + Projects page + light Project overview (header + milestones + embedded §B surface). Cycle chip/group + opt-in per-team Cycles page. Team settings › Statuses editor. | Net-new but thin — overview embeds the Phase-2 surface. |
| **5. Agent consolidation** | ⌘K "Ask agent" mode → panel; context chip pin/clear polish; Sessions in panel (absorbs Runs); Approvals merged into Inbox (source facet); Connectors/config → Settings › Agents; **Agent board removed from dock**. | Mostly rewiring into existing chrome; deletes a board. |

Phase 1 alone resolves the stated complaint (dead breadth + wrong nouns). Phases 2–3 deliver the
Linear feel. Phase 5 is independent of 2–4 and can be pulled earlier if the agent surface is the
hotter pain.

---

## What this proposal refuses to do

- No Timeline layout until Projects have dates (honest > impressive).
- No Triage, Templates, Components, or Labels-as-nav — Huly's added panels are the cautionary
  tale; anything expressible as a filter stays a filter.
- No Accept anywhere but the Inbox — including the chat panel. The moat loop is the product.
- No new top-level destination for anything introduced here. The nav list in §A is closed.
