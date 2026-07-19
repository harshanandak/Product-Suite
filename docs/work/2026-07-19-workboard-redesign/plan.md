# Workboard IA + Agent Surface Redesign — Implementation Plan

Date: 2026-07-18. Executes the approved proposal at
`.superpowers/sdd/workboard-ia-redesign-proposal.md`. Every path/symbol below was
verified against the live code in this worktree
(`C:/Users/harsha_befach/Downloads/Product-Suite/.worktrees/work-ontology`).

**How to run tests:** from `apps/platform-web/`: `npm run test` (= `vitest run`; `bun run test`
also works). This is the slow suite — during a task, run the touched files only
(`npx vitest run src/shell/boards.test.ts`), full suite at task end.

**Discipline:** every task is TDD (write/adjust the failing test FIRST, watch it fail, implement,
watch it pass, commit). One commit per task. Tasks are independently reviewable; each names the
existing test to mirror so an implementer with zero context follows the house style. The vitest
setup is `src/test/setup.ts` + `src/test/harness.tsx` (render helpers used by every screen test).

---

## Verified code facts the whole plan builds on (do not re-derive)

1. **Contracts are already ahead of the UI.** `packages/contracts/src/index.d.ts` already defines
   `Team` (~line 551), team-scoped `Status` (~567), `StatusCategory` (~494), and `WorkItem` with
   **mandatory `team_id` (~625) and `status_id` (~627)**, `parent_id: string | null` (~639),
   `department` marked `@deprecated` name-carrier (~646), `phase: Phase` still present
   (`"plan" | "execute" | "review" | "done"`, ~421). **No `Cycle`, no `Milestone` anywhere in
   contracts** — those are Phase-4 contract additions.
2. **The frontend data layer already populates the new fields.**
   `apps/platform-web/src/data/work-items/fixtures.ts` (~lines 234–262) derives
   `team_id = "team_" + department.toLowerCase()` and a per-team `status_id` for every item;
   `repository.ts` defaults both on create (~292–297). But **the UI reads `item.department`
   (free-text team NAME) and `item.phase`** everywhere. There is no Team table / statuses list /
   Cycle in the frontend data layer.
3. **The 5 “dead screens” are not 5 files** — they are 5 routes in `src/router.tsx`
   (`workboardStrategyRoute`, `workboardInsightsRoute`, `workboardTasksRoute`,
   `workboardTriageRoute`, `workboardFeedbackRoute`, lines 116–140) that all render the ONE shared
   placeholder `src/shell/BoardScreen.tsx`. `BoardScreen` itself **stays** (meetings/canvas/agents/
   settings/home still use it). Deleting the workboard rows = deleting route defs + nav rows only.
4. **Nav is config-driven.** `src/shell/boards.ts` `BOARDS[1]` (workboard) declares rows
   `work-items`, `graph` (`nested: true`), `strategy`, `insights`, `tasks`, `triage`,
   `intake` (section), `feedback`. `Sidebar.tsx` renders purely from `board.items`;
   `prototypeOnly` rows render as toast-only buttons (existing stub mechanism, line 104–123).
   `resolveScreen()` (boards.ts ~363) titles screens by exact interpolated match against
   `board.items`.
5. **Palette** (`src/shell/CommandPalette.tsx`) is cmdk-based, board-nav + 3 actions only, and is
   mounted by `ShellLayout.tsx` (which owns `paletteOpen`, mod+K, mod+1..5 — lines 73, 122–138).
   `RepositoryProvider` wraps the router in `src/main.tsx` (lines 56/77), so the palette CAN reach
   the work-items repository via `useRepositoryContext()`. `WorkItemRepository.list(): Promise<WorkItem[]>`
   (repository.ts:128).
6. **Filter state** (`src/boards/workboard/filter-state.ts`):
   `GroupByField = "none" | "department" | "phase" | "priority" | "type"` (line 59, default
   `"department"`), `WorkboardFilters` has Sets for `type/owner/department/phase/priority` (75–90),
   `WorkboardView = "table" | "kanban"` (299), persistence keys `workboard.filters.v1` (306) and
   `workboard.savedViews.v1` (505), `workboardDepartments()` (225), facet builders (267).
7. **Detail page** (`src/boards/workboard/detail/WorkItemDetailScreen.tsx`) already has
   Overview · Checks · Activity tabs (lines 604–630) with a WRITABLE `ChecksTab` (163) — Phase 3
   promotes Checks out of the tab, it does not build check-writing.
8. **Auth**: Clerk is wired (main.tsx, UserMenu, ShellLayout getToken) but there is **no mapping
   from the Clerk user to an `Owner`** in the work-items data. “My Items = assignee-me” cannot be
   honestly resolved in fixtures mode today (see Risks).
9. **Agent chat**: `AgentChatPanel` mounted app-wide by ShellLayout (lines 13–15, 227–261);
   `src/agent-chat/linked-object.ts` exports `workItemIdFromPath()` + `resolveLinkedObject()`;
   `ProposalCard` already deep-links `?proposal=<id>` handled by `homeInboxRoute`
   (router.tsx 73–82). Phase 5 is rewiring, as the proposal claims.

---

# PHASE 1 — Cut + realign (full TDD breakdown)

Net effect: sidebar shows `My items · Views · Projects · TEAMS › <one row per team>`; the five dead
rows + Intake header + Graph row are gone; `/workboard/{strategy,insights,tasks,triage,feedback}`
404 (routes deleted); `/workboard/graph` redirects to `/workboard`; every user-visible
“Department” reads “Team” and every “Phase” reads “Status”; ⌘K finds and opens work items.

**Task order is load-bearing** (each keeps the tree compiling + suite green):
1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8.

---

### Task 1.1 — Nav data model: new workboard rows + `buildWorkboardItems(teams)`

**Files:**
- Modify `apps/platform-web/src/shell/boards.ts`
- Modify `apps/platform-web/src/shell/boards.test.ts`
- Modify `apps/platform-web/src/shell/Sidebar.test.tsx` (assertions that reference deleted rows)

**Behavior:** The workboard `BoardDef.items` static list becomes exactly:
```ts
{ key: "my-items", label: "My items", to: "/w/$workspace/workboard", icon: ListChecks },
{ key: "views",    label: "Views",    icon: Star,   prototypeOnly: true }, // goes live Phase 2
{ key: "projects", label: "Projects", icon: Target, prototypeOnly: true }, // goes live Phase 4
```
(`prototypeOnly` is the existing stub mechanism — renders a toast button, NO dead route. Delete the
`strategy`, `insights`, `tasks`, `triage`, `feedback`, `intake`, and `graph` entries and the
now-unused lucide imports: `Lightbulb`, `ListTodo`, `Network`, `Target` if unused after edits.)

Add a new PURE function (same file, mirrors the existing helpers’ style):
```ts
export interface TeamRef { id: string; name: string }
/** Static workboard rows + a TEAMS section with one row per team. */
export function buildWorkboardItems(teams: ReadonlyArray<TeamRef>): SidebarItem[]
```
- Returns the 3 static rows above; when `teams.length > 0` appends
  `{ key: "teams", label: "Teams", section: true }` then per team
  `{ key: `team-${team.id}`, label: team.name, to: (`/w/$workspace/workboard/team/${team.id}`) as To, icon: Users }`.
- The team path embeds the concrete team id at build time; `$workspace` stays a template so the
  existing `interpolate`/`href` bridge works unchanged (this is the same single-assertion pattern
  `href()` already documents at boards.ts:291–298).

Also: give `resolveScreen` an optional third param
`extraItems: ReadonlyArray<SidebarItem> = []` merged into the item match, so team screens get
titled by team name (ShellLayout passes the merged items in Task 1.3).

**Test first** (mirror `boards.test.ts` — e.g. `"declares the five boards in canonical dock order"`
at line 13 and the resolveScreen block at 66):
```ts
describe("workboard nav (IA redesign)", () => {
  it("declares exactly My items, Views, Projects as the static workboard rows", ...)
  it("has no strategy/insights/tasks/triage/feedback/intake/graph entries", ...)   // keys absent
  it("buildWorkboardItems appends a TEAMS section with one row per team", ...)     // to contains /workboard/team/<id>
  it("buildWorkboardItems with no teams omits the section header", ...)
  it("resolveScreen titles a team screen from extraItems", ...)
});
```
Update in the same commit: `boards.test.ts` old assertions on the deleted rows;
`Sidebar.test.tsx:135` (`"indents a nested item (Graph) under its parent…"`) — DELETE that test
(no nested rows remain) and update any Sidebar test fixture that targeted `Strategy`/`Feedback`
rows. `Sidebar.tsx` itself needs NO changes (renders whatever items it gets; keep the
`nested` support — Phase 2+ may reuse it).

**Commit:** `feat(workboard): replace dead nav rows with My items/Views/Projects + buildWorkboardItems`

---

### Task 1.2 — Router: delete the 5 dead routes, redirect /workboard/graph

**Files:**
- Modify `apps/platform-web/src/router.tsx`
- Modify `apps/platform-web/src/router.test.tsx`
- Modify `apps/platform-web/src/main.test.tsx` if it smoke-navigates any deleted path (grep it)

**Implementation:**
- Delete `workboardStrategyRoute`, `workboardInsightsRoute`, `workboardTasksRoute`,
  `workboardTriageRoute`, `workboardFeedbackRoute` (lines 116–140) and their 5 entries in
  `routeTree.addChildren` (222–226).
- `workboardGraphRoute` (104–108): keep the path for old links, replace the component with a
  redirect:
  ```ts
  import { redirect } from "@tanstack/react-router";
  const workboardGraphRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "workboard/graph",
    beforeLoad: ({ params }) => {
      throw redirect({ to: "/w/$workspace/workboard", params });
    },
  });
  ```
  Remove the now-unused `WorkboardGraphScreen` import. **Do NOT delete
  `src/boards/workboard/graph/**`** — the components return as a Layout in Phase 2 and their own
  unit tests stay green.
- `BoardScreen` import stays (still used by home/meetings/canvas/agents/settings routes).

**Test first** (mirror `router.test.tsx:40` `"registers the expected workspace and sign-in full
paths"`): update the expected-paths list (remove the 5), and add:
```ts
it("redirects /w/:ws/workboard/graph to the workboard items surface", async () => {
  // createMemoryHistory({ initialEntries: ["/w/test-ws/workboard/graph"] }) + router.load()
  // assert router.state.location.pathname === "/w/test-ws/workboard"
});
```

**Commit:** `feat(router): prune dead workboard routes; /workboard/graph redirects to items`

---

### Task 1.3 — `useTeams()` + ShellLayout renders the TEAMS section

**Files:**
- Create `apps/platform-web/src/data/work-items/use-teams.ts` + `use-teams.test.ts`
- Modify `apps/platform-web/src/data/work-items/index.ts` (export it)
- Modify `apps/platform-web/src/shell/ShellLayout.tsx` + `ShellLayout.test.tsx`

**Behavior:** `useTeams({ repository? })` returns `{ teams: TeamRef[], loading }` — unique
`{ id: item.team_id, name: item.department }` pairs derived from `repository.list()`, sorted by
name. (The deprecated `department` field is the ONLY client-side source of the team display name —
contracts document it as the retained name carrier; a real `listTeams()` endpoint is the Phase-4
backend dependency.) Follow `use-work-items.ts` conventions: repository from
`useRepositoryContext() ?? getDefaultRepository()`, captured once; mounted-flag guard on the async
set.

ShellLayout: when the active board id is `"workboard"`, render the Sidebar with
`{ ...board, items: buildWorkboardItems(teams) }` and pass the same merged items to
`resolveScreen` as `extraItems` (for the TopBar title). Other boards unchanged.

**Test first:**
- `use-teams.test.ts` (mirror `use-work-items.test.ts` setup): seeds a fixture repository →
  expects deduped, sorted `{id,name}` pairs; empty repository → `[]`.
- `ShellLayout.test.tsx` (mirror its existing render tests): on `/w/test-ws/workboard` the rail
  shows `TEAMS` + one row per fixture team, and does NOT show `Strategy`/`Insights`/`Tasks`/
  `Triage`/`Feedback`/`Graph`.

**Commit:** `feat(workboard): teams section in the rail via useTeams + buildWorkboardItems`

---

### Task 1.4 — Team-scoped items route `/workboard/team/$teamId`

**Files:**
- Modify `apps/platform-web/src/boards/workboard/WorkboardScreen.tsx` + test
- Modify `apps/platform-web/src/router.tsx` + `router.test.tsx`

**Behavior:** `WorkboardScreenProps` gains `teamId?: string`. When set:
- rows are pre-scoped BEFORE user filters: `items.filter(i => i.team_id === teamId)` feeding the
  existing `applyWorkboardFilters` memo (WorkboardScreen.tsx ~204);
- the Team toolbar facet is hidden (scope already fixed — pass a flag down to the toolbar,
  `hideTeamFacet`), and the empty-state copy says “No items in this team yet”;
- fix the params read: `useParams({ from: "/w/$workspace/workboard" })` (line 177) →
  `useParams({ strict: false })` with a `workspace ?? DEFAULT_WORKSPACE` fallback (the
  `BoardScreen.tsx:14` pattern), so the one screen serves both routes.

Router: add
```ts
const workboardTeamRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/team/$teamId",
  component: TeamItemsScreen,   // thin wrapper in WorkboardScreen.tsx: reads $teamId, renders <WorkboardScreen teamId=… />
});
```
(+ tree entry). `deriveActiveBoard` needs NO change (first segment is still `workboard`).

**Test first** (mirror `WorkboardScreen.test.tsx` repository-injection pattern — the screen takes
`repository` as a seam):
```ts
it("scopes rows to the given teamId and hides the Team facet", ...)
it("still applies search/facets within the team scope", ...)
```
and in `router.test.tsx`: the expected-paths list gains `/w/$workspace/workboard/team/$teamId`.

**Commit:** `feat(workboard): team-scoped items route /workboard/team/$teamId`

---

### Task 1.5 — `department → Team`: rename the UI dimension (state keys + labels)

**Scope call (verified, decisive):** this is a **UI-layer rename only**. The data fields
(`WorkItem.department`, `WorkItem.team_id`) and contracts are already correct and DO NOT change.
What renames is the workboard view-state vocabulary and every visible label. Phase 2 builds
Group×Filter on this state — rename now so Phase 2 never builds on the wrong noun.

**Files (all modify, with their tests):**
- `src/boards/workboard/filter-state.ts` + `filter-state.test.ts` — the hub:
  - `GroupByField`: `"department"` → `"team"` (default `groupBy: "team"`, line 123);
  - `WorkboardFilters.department: Set<string>` → `team: Set<string>` (filter VALUES stay the
    department/team NAME strings — they match `item.department`, which `applyWorkboardFilters`
    keeps reading; add a one-line comment marking that read as the deprecated-name seam);
  - `workboardDepartments()` → `workboardTeams()`;
  - persistence: `FILTER_STORAGE_KEY` → `"workboard.filters.v2"`, `SAVED_VIEWS_KEY` →
    `"workboard.savedViews.v2"`, and the persisted-filter key list (~331) `"department"` →
    `"team"`. Old v1 blobs are simply ignored (fresh defaults) — cheap, safe, no migration code.
- `src/boards/workboard/WorkboardScreen.tsx` + test — `hydrateFilterState`, `clearAllFilters`,
  `departments` memo → `teams`, empty-state copy `"across departments"` → `"across teams"`.
- `src/boards/workboard/toolbar/WorkboardToolbar.tsx` + test — labels at lines 146
  (`department: "Department"` → `team: "Team"`), facet chip + menu label `"Department"` → `"Team"`
  (~361, ~492), `toggleDepartment` → `toggleTeam`, props `departments` → `teams`.
- `src/boards/workboard/toolbar/FacetFilterMenu.tsx` + test — prop/label pass-through renames.
- `src/boards/workboard/table/WorkboardTable.tsx` + test — group-header path for `groupBy:"team"`,
  any `"Department"` strings.
- `src/boards/workboard/kanban/WorkboardKanban.tsx` + test — swimlane grouping key + headers.
- `src/boards/workboard/editor/WorkItemEditor.tsx` + test — the field label `"Department"` →
  `"Team"` (the patch still writes `department` — contracts accept it for back-compat; add a
  `// TODO(phase-4): write team_id` comment and file a kernel issue, see Risks).
- `src/boards/workboard/detail/WorkItemDetailScreen.tsx` + test — the single `department` rail
  label → `"Team"`.
- LEAVE `src/boards/workboard/graph/**` untouched (unreachable until Phase 2 re-skins it) and
  LEAVE `src/data/**` untouched.

**Test first:** flip the assertions in `filter-state.test.ts` (26 hits) to the new keys — run,
watch the type errors + failures cascade, then mechanically rename until the file set compiles and
all listed component tests (label assertions like `getByText("Department")` →
`getByText("Team")`) pass. This task is big but PURELY mechanical; TS makes partial renames
impossible to miss.

**Commit:** `refactor(workboard): rename the department dimension to Team across view state + labels`

---

### Task 1.6 — `phase → Status`: label-only rename (the deliberate split)

**Scope call (decisive, flag-carrying):** items really do carry `phase: plan|execute|review|done`
AND a `status_id`, but there is no statuses table/endpoint client-side, and Board columns/health
(`deriveHealth({ phase, … })`) key off `phase`. So Phase 1 renames ONLY user-visible copy —
**every “Phase” label reads “Status”; the four value labels Plan/Execute/Review/Done are
unchanged; code identifiers and data fields keep `phase`.** Introducing real per-Team Status
(field flip `phase` → `status_id`, team-owned names, Statuses editor) is Phase 4 and needs
backend/data work. Do not half-rename identifiers here.

**Files:** `WorkboardToolbar.tsx` (lines 66, 147, 165 `"Phase"` → `"Status"`) + test,
`WorkboardTable.tsx` column header + test, `WorkboardKanban.tsx` group headers + test,
`WorkItemEditor.tsx` field label + test, `WorkItemDetailScreen.tsx` rail label + test,
`WorkboardScreen.test.tsx` label assertions. Graph untouched (unreachable).

**Test first:** change the label assertions (`"Phase"` → `"Status"`) in the five test files, watch
them fail, then flip the literals. Grep-gate inside the task: `grep -rn '"Phase"' src/boards/workboard
--include='*.tsx' -l` returns only `graph/` files when done.

**Commit:** `refactor(workboard): phase renders as Status in all user-visible copy (field rename deferred)`

---

### Task 1.7 — Command palette: work-item search + open-by-id

**Files:**
- Modify `apps/platform-web/src/shell/CommandPalette.tsx` + `CommandPalette.test.tsx`

**Behavior:** palette gains a `"Work items"` group above `"Boards"`:
- Data: `const repo = useRepositoryContext() ?? getDefaultRepository()`; add an optional
  `repository?: WorkItemRepository` prop as the test seam (the exact `WorkboardScreenProps`
  precedent, WorkboardScreen.tsx:57). On `open` becoming true, `repo.list()` into local state
  (guarded, once per open; palette already early-returns `null` when closed so keep the hooks
  above that return — they already are).
- Each item renders as a `Command.Item` with `value={`${item.id} ${item.title}`}` — cmdk's
  built-in filtering then matches BOTH title text and pasted/typed ids (“open-by-id” with no
  special-casing). Cap rendered items via cmdk’s scoring (no manual cap needed; the list is
  virtualized by max-height + overflow already, line 97).
- `onSelect` → `onOpenChange(false)` + `navigate({ to: "/w/$workspace/workboard/item/$itemId",
  params: { workspace, itemId: item.id } })` — the typed-params pattern already used by
  “Log a decision” (CommandPalette.tsx:130–139).

**Test first** (extend `CommandPalette.test.tsx`, which already renders
`<CommandPalette open onOpenChange … workspace="test-ws" />`):
```ts
it("lists work items from the repository and filters by title", ...)
it("matches a work item by its id (open-by-id)", ...)
it("navigates to the item detail page on select", ...)  // assert via router/history harness
```

**Commit:** `feat(palette): work-item search + open-by-id navigating to item detail`

---

### Task 1.8 — Phase-1 gate sweep

**Files:** whatever the greps surface; no new features.

1. Grep-gates (all must be clean):
   - `grep -rn 'workboard/(strategy|insights|tasks|triage|feedback)' apps/platform-web/src` → 0 hits.
   - `grep -rn '"Department"\|"Phase"' apps/platform-web/src/boards/workboard --include='*.tsx'`
     → hits only under `graph/`.
   - `grep -rn 'prototypeOnly' apps/platform-web/src/shell/boards.ts` → only `views`/`projects`
     (+ agent-board rows, which Phase 5 deletes).
2. Delete dead imports/icons flagged by lint (`--max-warnings 0` is enforced on push).
3. Full suite: `npm run test` in `apps/platform-web` green; `npm run lint` green.
4. Manual before→after screenshot pass against the proposal §A diagram (reviewer artifact).

**Commit:** `chore(workboard): phase-1 gate sweep — dead vocabulary and routes fully purged`

---

# PHASES 2–5 — task-level outlines

## Phase 2 — One surface + display options (net-new toolbar; renderers reused)

| # | Task | Nature | Notes / deps |
|---|---|---|---|
| 2.1 | `filter-state.ts`: add `layout: "list" | "board" | "graph"` (replaces `WorkboardView`), `sortBy: "manual" | "priority" | "updated" | "created" | "due"` (default `updated`), extend `GroupByField` with `"status" | "project" | "cycle" | "assignee"` (cycle gated until Phase 4 data) + persistence v3 | rewire | Pure-function TDD like today’s filter-state tests |
| 2.2 | Display-options toolbar: one `Layout ▾ / Group ▾ / Filter + / Sort ▾` popover row replacing the tabs-as-views arrangement in `WorkboardToolbar` | net-new UI | shadcn DropdownMenu; proposal §B table is the spec |
| 2.3 | Wire `WorkboardGraph` as the third Layout renderer inside `WorkboardScreen`’s `activeView` switch (it currently renders table|kanban, line 535); delete `WorkboardGraphScreen` + its route redirect’s permanence note; rename graph’s “Phase/Department” internals to Status/Team now that it is reachable | rewire + delete | Graph components already exist under `boards/workboard/graph/` |
| 2.4 | Saved Views live in the rail: `views` row drops `prototypeOnly`, gets `/workboard/views` route listing `SavedView`s (they already exist in filter-state.ts:513 + localStorage); apply = navigate to `/workboard` with the config applied | rewire | Views are bookmarks — reuse `handleApplyView` |
| 2.5 | Sort implementation in `applyWorkboardFilters` output ordering + per-layout honoring | rewire | |

No backend dependency in Phase 2 (all client state). Sign-off gate below.

## Phase 3 — Task inline-nesting + Checks-as-module (net-new, contained)

| # | Task | Nature | Notes / deps |
|---|---|---|---|
| 3.1 | Data: expose `parent_id` through fixtures + repository create/patch (`parent_id` exists in contracts WorkItem:639; fixtures currently set it null) + a `childrenByParent` selector | rewire | **Backend/contract: none — field exists.** Backend create-with-parent must be verified server-side |
| 3.2 | List nesting: disclosure chevron + one-level indent + `▰▰▱ 2/3` progress on parent rows in `WorkboardTable`; `Tasks: Nested/Flat/Hidden` display option in filter-state + toolbar | net-new UI | proposal §C mockup is the spec |
| 3.3 | Detail: `+ Add task` inline-entry block + Tasks module (child list) in `WorkItemDetailScreen`; parent breadcrumb (`ITM-142 ▸ ITM-151`) on child detail | net-new UI | |
| 3.4 | Checks promoted: move the writable `ChecksTab` content (detail screen line 163) onto the Overview as a module in the §C order (title → properties → description → Checks → Tasks); Activity stays a tab | rewire | zero new check logic |

## Phase 4 — Project/Cycle lenses + Statuses editor (thin net-new, REAL backend deps)

| # | Task | Nature | Notes / deps |
|---|---|---|---|
| 4.1 | Project chip/group/filter on the item surface (`listProjects()` already exists, repository.ts:130; `project_id` on WorkItem) | rewire | none |
| 4.2 | `projects` row goes live: `/workboard/projects` list + light Project overview (header, lead, target date, progress, Milestones strip, embedded Phase-2 surface filtered to project) | net-new UI | **Contract dep: `Milestone` + Project target-date fields do NOT exist in contracts — add there first** |
| 4.3 | Cycle chip/group/filter + per-team opt-in Cycles page | net-new UI | **Contract dep: NO `Cycle` in contracts — new entity + team opt-in flag + backend** |
| 4.4 | Real per-Team Status: client `listStatuses()` surface, Board columns/list groups keyed by `status_id` (replacing `phase` reads), `deriveHealth` migration, Team settings › Statuses editor (name/order/category) | net-new + data flip | **The deferred half of Task 1.6.** Contracts `Status`/`StatusCategory` exist; needs statuses endpoint + WorkItemPatch.status_id write path + a phase→status backfill decision |

## Phase 5 — Agent consolidation (rewiring into existing chrome; deletes a board)

| # | Task | Nature | Notes / deps |
|---|---|---|---|
| 5.1 | ⌘K “Ask agent” mode: Tab/`?` flips the palette input to prompt mode; submit opens `AgentChatPanel` pre-bound (route context via `resolveLinkedObject`, linked-object.ts:28) with the prompt as first message; replace the toast stub at CommandPalette.tsx:154–163 | net-new (small) | panel + context resolution already exist |
| 5.2 | Context chip pin/clear on the panel (persists across navigation) | net-new (small) | |
| 5.3 | Sessions list in the panel header (clock icon → past threads; `data/agent/threads.ts` exists) — absorbs the Runs list | rewire | |
| 5.4 | Approvals → Inbox: add a source facet (chat/autonomous/connector) to `InboxScreen` filters; delete the `agents/approvals` route | rewire + delete | Inbox filter model already exists |
| 5.5 | Connectors/config → Settings › Agents (settings route currently BoardScreen placeholder — first real settings content) | rewire | |
| 5.6 | Delete the Agent board: remove `BOARDS[4]` (boards.ts:232–274), the 4 `agents*` routes (router.tsx:184–203), dock entry auto-follows (`BoardDock` renders from BOARDS); update `deriveActiveBoard` (drop the `"agents"` case), boards/BoardDock/router tests; mod+1..5 becomes mod+1..4 | delete | independent of Phases 2–4, can be pulled earlier |

---

# Per-phase SIGN-OFF GATES

**Phase 1 — gate:**
- `npm run test` (full platform-web suite) + `npm run lint` green.
- Rail shows exactly: `My items · Views · Projects · TEAMS › <fixture teams>` — screenshot matches
  proposal §A right-hand diagram; zero dead rows (every row navigates or is an explicit
  prototype-toast stub).
- Routes: the 5 dead paths 404 via notFound; `/workboard/graph` redirects to `/workboard`;
  `/workboard/team/<id>` renders the scoped surface.
- Vocabulary: no user-visible “Department”/“Phase” anywhere reachable (grep gate 1.8).
- ⌘K: typing an item title or id surfaces it; select lands on the detail page.
- Reviewer verifies before→after against §A and the frozen ontology nouns (Team/Status/Item).

**Phase 2 — gate:** one `/workboard` surface where Layout List/Board/Graph × Group × Filter × Sort
all compose (proposal §B mockup match); graph route gone; a saved View round-trips
(save → rail → apply); suite green.

**Phase 3 — gate:** a parent row expands to indented Tasks with a correct `n/m` fraction; `+ Add
task` creates a child visible in list + detail; child detail shows the parent breadcrumb; Checks
render on the Overview (§C module order), Activity still a tab; suite green.

**Phase 4 — gate:** `Group: Project`/`Group: Cycle` work; Projects page → overview embeds the
filtered surface with a live Milestones strip; a team can rename/reorder statuses in the editor and
board columns follow (one source of truth); `phase` no longer read by any list/board surface;
contract additions reviewed against `@product-suite/contracts` conventions; suite green.

**Phase 5 — gate:** the user rule holds — “talk in the panel, approve in the Inbox”: no
Accept outside the Inbox; ⌘K Tab → prompt → panel opens bound to route context; dock shows 4
boards; `agents/*` routes gone; Inbox source facet filters proposals; suite green.

---

# Risks / sequencing notes

1. **`phase → Status` is a two-step rename, and collapsing it would corrupt semantics.** Items
   genuinely run on the 4-value `phase` enum today (health derivation, kanban columns, facets),
   while the mandatory `status_id` has no client-side statuses table to resolve names against.
   Mitigation: Phase 1 renames COPY only (Task 1.6, explicitly scoped); the field flip is Phase 4
   Task 4.4 with its named backend deps (statuses endpoint, status_id write path, backfill). File a
   kernel issue for 4.4 at Phase-1 close so the label/field divergence is tracked, not forgotten.
2. **Team display names ride the deprecated `department` field.** `useTeams()` and the Team filter
   values both read `item.department` because it is the only name source client-side (contracts
   keep it precisely for this back-compat). If the backend ever stops populating it before a
   `listTeams()` endpoint exists, the rail and facets lose names. Mitigation: the seam is
   concentrated in `use-teams.ts` + one comment-marked read in `applyWorkboardFilters`; the
   `listTeams()` endpoint is a named Phase-4 dependency. Same applies to `WorkItemEditor` writing
   `department` (not `team_id`) — file the follow-up issue at Phase-1 close.
3. **“My Items” has no honest assignee-me resolution yet.** Clerk identity exists but maps to no
   `Owner` in the work-items data (verified: no currentOwner/useUser→Owner bridge). Phase 1 ships
   the row landing on the cross-team surface (all items) — functionally today’s `/workboard`.
   Mitigation: file the “me-filter needs Clerk→Owner mapping” issue as a Phase-1 exit criterion;
   when the mapping lands, the filter is a one-line default (`filters.owner = {me}`) on the
   `my-items` route.
4. **Test-suite blast radius of the renames.** ~23 files reference `department`, ~37 reference
   `phase`; Phase 1 touches the UI subset (filter-state, toolbar, table, kanban, editor, detail,
   screen tests — the counts per file are in the task briefs). Mitigation: Tasks 1.5/1.6 are
   type-driven mechanical renames (TS fails loudly on any miss) and each carries its own test
   updates; graph/ files are intentionally exempt until Phase 2. platform-web is the slow suite —
   run per-file during tasks, full suite only at task close and the 1.8 gate.
5. **Deleting nav rows breaks sibling tests, not just their own.** Verified consumers:
   `Sidebar.test.tsx` (nested-Graph test, line 135), `boards.test.ts` (workboard rows),
   `router.test.tsx` (path list), possibly `main.test.tsx` smoke routes. Each deletion task names
   its test-update set; nothing outside `apps/platform-web/src` imports these routes (BoardScreen
   stays for the other boards).
6. **Old localStorage view blobs.** Key bump to `workboard.filters.v2`/`savedViews.v2` (Task 1.5)
   orphans v1 blobs instead of mis-parsing `department` keys — users lose saved local views once,
   which is acceptable pre-GA and infinitely safer than a migration shim; Phase 2 bumps to v3 with
   the same policy.
