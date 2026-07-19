# Workboard Redesign Research — How Linear & Huly Visualize Multi-Level Work

Research date: 2026-07-18. External study to guide simplifying Product-Suite's workboard.
Our frozen ontology: **Workspace(tenant) → Team (owns statuses/cycles) → Item (work atom) →
Task (Item with a parent) / Check (frozen checklist row); Project = optional cross-team outcome
container (owns milestones).**

Complaint being solved: too many things visualized at too many levels; access/navigation too complex.
Goal: simplify like Linear / Huly.

---

## 1. Linear patterns (cited)

**Conceptual model** — one atom, everything else is a container or a lens.
(https://linear.app/docs/conceptual-model)
- **Issue** is *the* fundamental unit of work. Everything (bug, feature, task, request) is an Issue.
  There is no separate "task" type — an Issue can be assigned, labeled, prioritized, put in a project,
  planned into a cycle. This is the single most important simplification: **one primitive, many facets.**
- **Team** is the primary organizational unit and owns workflow statuses, cycles, labels, triage. Every
  Issue belongs to exactly one team.
- **Workspace** is the top container (company). Switched from a dropdown, not a nav destination.
- **Project** groups Issues around a shared outcome/target date; can span multiple teams; owns its own
  progress graph and **milestones**; owns no workflow. An Issue belongs to at most one project.
- **Cycle** is a team's repeating planning period (auto-repeating every N weeks); belongs to a team.
- **Initiative** (Enterprise) groups *projects*, not issues.

**Left nav / IA** (https://linear.app/docs/teams, https://linear.app/docs/custom-views)
Sidebar = a small fixed set of workspace-level destinations (Inbox, My Issues, Views, Projects) plus a
collapsible section **per team**. Each team expands to a short, fixed list:
`Triage* · Issues · Cycles* · Projects · Views` (Triage and Cycles are **opt-in**, off by default).
So depth is real but the nav is shallow: destinations are bounded and repeat the same 4-5 nouns per team.

**Single dominant view + view-switcher, not many screens**
(https://linear.app/docs/display-options)
- Every work surface is the **same Issue list**, reconfigured by **Display options** (Shift V).
- **Layout** toggles List ↔ Board with one shortcut (Cmd/Ctrl B); Timeline for projects.
- **Grouping** by status, assignee, project, priority, cycle, label, **parent issue**, team, etc.
  Grouping is what replaces separate screens: "board by status" and "list grouped by cycle" are the
  same data, not different pages.
- **Ordering**, **sub-grouping**, **show/hide sub-issues**, and **display properties** are all toggles
  on this one surface. Filters + grouping + ordering = a "view"; saved filters become **Custom Views**
  (Alt V) that live under the sidebar Views page or contextually under a team's Issues/Projects section.
- A **right-hand view sidebar** offers quick-filter chips (assignees, labels, projects) — filtering
  without leaving the list.

**Sub-issues = inline nesting, not a destination**
(https://linear.app/docs/parent-and-sub-issues)
- Guidance: use a sub-issue when work is "too large to be a single issue but too small to be a project."
- Created **inside the parent** via `+ Add sub-issues` below the description; shown nested under the
  parent in the list. A sub-issue is a full Issue (own status/assignee), it just has a parent.
- In any list you can **toggle "show sub-issues"** (Display options) or filter to
  top-level-only / has-sub-issues / only-sub-issues. Optional parent auto-close when all subs are done.
- Key point: sub-issues never get their own nav entry — they surface **inline in the list** and in the
  parent detail.

**Command palette / keyboard-first access**
Cmd/Ctrl+K command menu + shortcuts (Shift V display options, Cmd/Ctrl B layout, O then V for views,
Shift P to move to project, C to create). Navigation and mutation happen from the keyboard, so the UI
does not need many visible buttons/destinations.

**The Linear Method** (https://linear.app/method) reinforces "scope projects down," keep momentum,
write issues not stories — i.e. keep the object model small and bias to the Issue.

### Linear's 4-6 design principles that create simplicity
1. **One primitive (the Issue) with facets, not many object types.** Task/bug/story are the same object.
2. **Containers are optional and additive** — project, cycle, parent are properties on an Issue, not
   mandatory levels you must traverse.
3. **One dominant surface (the list/board) reconfigured by Display options** — grouping/filtering/
   ordering replace separate screens.
4. **Shallow, repeating nav** — a bounded set of nouns (Issues/Cycles/Projects/Views) repeated per team;
   opt-in surfaces (Triage, Cycles) stay hidden until enabled.
5. **Depth shown inline or on drill-in, never as nav weight** — sub-issues nest in the list; detail
   lives in the item panel.
6. **Keyboard/command-palette access** removes the need for dense visible chrome.

---

## 2. Huly patterns (cited)

Huly's Tracker is a close Linear clone that adds a few more panels. Structure confirmed from the
open-source repo `plugins/tracker-resources/src/components`
(https://github.com/hcengineering/platform/tree/develop/plugins/tracker-resources/src/components):

- Root components: `CreateIssue.svelte`, `IssuesView`, **`SubIssues.svelte`**, `LabelsView.svelte`,
  `NewIssueHeader.svelte`, plus subdirectories: **`projects/`, `milestones/`, `myissues/`,
  `templates/`, `components/`** (Huly's "Components" = sub-areas of a project), `icons/`.
- So a Huly project's left-nav children are: **Issues · Active · Backlog · My Issues · Components ·
  Milestones · Templates** — i.e. Linear's set plus Components and Templates (more panels = more nav
  weight; this is the "Huly adds more" tax).

**Tri-pane layout** (nav / list / detail): left **Navigator** panel (apps + spaces/projects tree),
center list/board of issues, right/overlay **issue detail panel**. *(Layout described from the
repo component split and Huly's product framing; a dedicated IA doc page 404'd — see Unverified.)*

**Issues / sub-issues**: sub-issues handled by `SubIssues.svelte` — nested under the parent issue in
the detail/list, same inline-nesting model as Linear (not a separate destination).

**Projects & Milestones** (https://docs.huly.io/task-tracking/milestones/)
- **Milestones are owned by a project** and cannot be moved between projects.
- Created under a project ("select Milestones under any project → + Milestone"), with name, status,
  deadline.
- Crucially, a milestone is treated as **just another issue attribute**: you can toggle showing the
  milestone on each issue, **group the whole Tracker by milestone**, or filter issues by milestone.
  So even though Milestones get a panel, their primary use is as a **grouping/filter dimension** on the
  one issue list — same lens philosophy as Linear.

**Takeaway from Huly**: it validates Linear's model but is a cautionary example — adding Components and
Templates as their own nav panels increases perceived complexity. The parts that stay simple are the
ones expressed as **attributes/lenses** on the issue list (milestones, components) rather than as
destinations.

---

## 3. Simplification principles (synthesized, 6)

1. **Collapse types into one atom.** Item is the only object users create/browse. Task and Check are not
   separate destinations — Task is an Item with a parent; Check is a frozen row inside an Item.
2. **Levels become properties, not nav layers.** Team, Project, Cycle, parent are facets on an Item you
   group/filter by — not folders you must click through.
3. **One primary surface, reconfigured.** A single Item list/board driven by a Display-options menu
   (layout + group-by + filter + order) replaces a sprawl of separate screens.
4. **Shallow, repeating nav.** A bounded set of nouns per Team; opt-in surfaces stay hidden until turned
   on. Never add a top-level destination for something that could be a filter, group, or tab.
5. **Depth is inline or drill-in.** Sub-items (Tasks) nest inline in the list and appear in the parent
   detail; Checks live only inside the Item detail. Neither is a nav entry.
6. **Keyboard/command-palette + right-side quick-filter** carry access, so visible chrome stays minimal.

---

## 4. Ontology mapping — our levels → destination / filter / inline / drill-in

| Our level | Verdict | How it should appear |
|---|---|---|
| **Workspace (tenant)** | Not a destination | Org switcher in a corner menu (Linear pattern). |
| **Team** | **Top-level destination** (the one hierarchy you traverse) | Sidebar section per team; expands to a short fixed noun list. Owns statuses/cycles so it must be a real place. |
| **Item (atom)** | **The primary surface** | The single Issues list/board. Everything else is a lens on this. |
| **Task (Item w/ parent)** | **Inline-nest + drill-in** | Nested under its parent in the list (toggle "show sub-items"); created from the parent detail; full detail on drill-in. NOT a nav entry. Mirrors Linear sub-issues. |
| **Check (frozen checklist row)** | **Drill-in only (inside Item detail)** | A checklist section within the Item detail panel. Never a list surface, never nav. |
| **Project (cross-team outcome)** | **Filter/group + lightweight destination** | Primarily a **group-by / filter** dimension on the Item list, plus a workspace-level Projects page (list/board/timeline) and a Project overview on drill-in. Accessed without per-team nav weight. |
| **Milestone (owned by Project)** | **Filter/group + tab inside Project** | Attribute on Items (group/filter by milestone, à la Huly) + a Milestones list inside the Project overview. Not top-level. |
| **Cycle (owned by Team)** | **Opt-in destination + group/filter** | Off by default; when on, one Cycles page per team + a group-by/filter dimension on the Item list. |
| **Status (owned by Team)** | Not a destination | The default **group-by** on board columns / list sections. |

Specific answers to the brief:
- **(a) Deserves a top-level destination:** only **Team** (mandatory owner) and a single workspace-level
  **Projects** page. Everything else is a filter/group/inline/drill-in.
- **(b) Tasks (sub-items):** Linear's sub-issue model exactly — inline nested rows in the list with a
  "show sub-items" toggle + parent-detail editor; a Task is a full Item, not a lesser type.
- **(c) Checks:** live **inside the Item detail** as a checklist section. Never a nav destination,
  never a list.
- **(d) Projects (cross-team):** reached as (i) a group-by/filter on the Item list and (ii) one
  workspace Projects page — so cross-team access adds **zero per-team nav weight**.
- **(e) Single primary view + switcher:** one Item list/board with a Display-options menu
  (Layout: List/Board/Timeline · Group by: status/assignee/project/cycle/priority/label/parent ·
  Filter · Order). Saved filter+group combos become named Views, replacing separate screens.

---

## 5. Recommended IA for the Product-Suite workboard

**Sidebar — KEEP (small, bounded):**
- Workspace switcher (corner menu, not a nav row)
- **Inbox / My Items** (workspace-level, personal)
- **Views** (saved custom views)
- **Projects** (workspace-level, cross-team)
- **Per-Team section** → expands to a fixed short list:
  `Items · Cycles* · Projects · Views` ( `*` opt-in, hidden until enabled). Add **Triage** only if you
  adopt a triage inbox.

**COLLAPSE into views/filters/detail (remove as destinations):**
- Tasks → inline nested rows under parent Items (+ "show sub-items" toggle) and parent detail.
- Checks → checklist section inside Item detail.
- Milestones → group-by/filter on Items + a tab in the Project overview.
- Statuses → board columns / list group headers (group-by), configured in Team settings, not browsed.
- Any "all sub-tasks" / "all checks" screen → delete; express as filters (`has parent`, `is task`).

**Primary-view model (the one screen that does most of the work):**
- Surface: **Item list/board**, opened per-team or filtered across teams.
- **Display options** menu: Layout (List / Board / Timeline), Group by (status default; also project,
  cycle, assignee, priority, label, parent), Filter, Order, Show sub-items on/off, Display properties.
- **View-switcher**: the same surface saved as named Views (per-team contextual or workspace-level),
  so users switch lenses instead of navigating to different screens.
- **Right-hand quick-filter** rail + **Cmd/Ctrl+K command palette** for keyboard-first access.

Net effect: the only hierarchy a user *traverses* is Workspace → Team → Item. Task, Check, Project,
Milestone, Cycle, Status all become **lenses (group/filter), inline nesting, or drill-in detail** on
that single Item surface — which is exactly what makes Linear (and the good parts of Huly) feel simple.

---

## Sources
- Linear — Concepts / conceptual model: https://linear.app/docs/conceptual-model
- Linear — Parent and sub-issues: https://linear.app/docs/parent-and-sub-issues
- Linear — Display options: https://linear.app/docs/display-options
- Linear — Custom Views: https://linear.app/docs/custom-views
- Linear — Projects: https://linear.app/docs/projects
- Linear — Teams: https://linear.app/docs/teams
- Linear — The Linear Method: https://linear.app/method
- Huly — Milestones docs: https://docs.huly.io/task-tracking/milestones/
- Huly — Tracker component source (repo): https://github.com/hcengineering/platform/tree/develop/plugins/tracker-resources/src/components

## Unverified / flags
- Huly **tri-pane layout** (navigator/list/detail) is inferred from the repo component split and product
  framing; the dedicated Huly IA/navigation doc page returned HTTP 404, so the exact panel chrome is not
  doc-confirmed. Repo file names (`IssuesView`, `SubIssues.svelte`, `projects/`, `milestones/`,
  `templates/`, `components/`, `myissues/`) ARE verified via the GitHub contents API.
- Linear's exact per-team sidebar item list is from the Teams doc; some items (Triage, Cycles) are
  explicitly opt-in per that doc.
- Linear cycles have a dedicated `/docs/use-cycles` page referenced by the conceptual model but not
  fetched directly here; cycle facts above come from the conceptual-model and teams docs.
