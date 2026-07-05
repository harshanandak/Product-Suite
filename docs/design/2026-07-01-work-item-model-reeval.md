# Work Item Model — Reevaluation Findings (2026-07-01)

> **⚠️ Superseded — exploratory design, not the shipped model.** Kept for design
> history. The build follows
> [`2026-07-05-work-item-port-plan.md`](2026-07-05-work-item-port-plan.md), which
> deliberately ships a lean subset (flat tasks + phase lifecycle; **no** nested
> containers, OKR/KeyResult, or KPI entities). This reevaluation is exploration, not a
> build contract.

Multi-agent review of `2026-07-01-work-item-nested-model.md` across 5 independent lenses
(coherence, dual-persona, gaps, over-engineering, buildability) + adversarial synthesis.

## Verdict: NOT ready to plan. Recommended path = **Option B.**
All five lenses independently converged on "needs rework." The containment idea is coherent in
isolation and the repository seam genuinely absorbs the transport + id-based dependency change — but
four critical problems block planning, and the deeper finding is that **the nested rewrite is low-ROI
for v1.**

## 4 critical blockers
1. **The "one shape, differ by depth not type" thesis breaks at the lifecycle field.** §3 gives
   *containers* a phase (In progress → Done, derived) and *leaves* a status (To do → Doing → In review →
   Done) — two different enums. That falsifies the core "one shape" claim and cascades `isLeaf` branching
   through hook / table / kanban / graph / editor / filter. → Pick ONE lifecycle enum for all depths (derive
   the coarse view) or define an explicit shared leaf.status → pseudo-phase projection *before* planning.
2. **The DAG cycle guard ignores containment → undetected deadlock.** Containment is an implicit dependency
   (a parent is Done only when children are Done). A legal edge "child C waits on parent P" passes the cycle
   check (one edge, no cycle) yet deadlocks permanently. → Run cycle detection over the UNION of dependency
   + containment edges; forbid a parent depending on its own descendant.
3. **The opt-in mechanism is unmodeled → simplicity promise inverts.** §4/§6 hang the whole "complexity is
   optional" guarantee on nothing — no mode / workspace-settings / feature-flag entity exists, and no default
   is set. A superset schema with no mode defaults to *complexity-visible*, i.e. the marketing persona sees
   everything. → Add a first-class Workspace/Space (or per-item) mode entity, default = simple, and enumerate
   what each mode shows/hides.
4. **The nested rewrite buys almost nothing for v1.** Current model is Project → WorkItem → Task (3 fixed
   levels). New model is a recursive Item *bounded to the same 3 levels*. Same depth, same three roles. Net
   gain = code-unification + any-level deps — in exchange for reconstructing the foundation. → Low ROI.

## Major issues
- **Derived rollups are partial functions.** Health has no leaf base case (what makes a leaf `at_risk` vs
  `blocked`?), no precedence, no blocked-propagation rule across levels. Milestone status counts only "tasks"
  but sub-items may link; empty-linkage undefined. Make each a total function.
- **Parent-close underspecified:** direct children vs all descendants? container-only/empty children? reopen
  on new child? owner-confirm vs Accept-gate ordering?
- **Field optionality unmarked** — title/priority/tags/due_date read as required; fate of `type`/`source`/
  `department` from today's model unstated (keep-optional vs delete?).
- **No ordering field** on Item, yet tree + backlog need child order / drag-reorder (unstorable today).
- **Blast radius undercounts** — §7 omits Kanban, Toolbar, fixtures rebuild, and ~all view tests.
- **OKR "chain" is manual, not derived** — KR `current_value` is hand-set; nothing propagates task/milestone
  completion up, so a milestone can be "missed" while its Objective still shows "on track." Frame as
  alignment/navigation only, or wire a real update rule.

## Gaps still owed (15, condensed)
Lifecycle enum decision · item.status value set (are Plan/Accept statuses, flags, or gates?) · cycle scope
over union · parent-close total function · health total function · milestone derivation + empty default ·
OKR wiring + single canonical alignment path + dedupe · the mode entity + default · field optionality +
type/source/department fate · child ordering field · access-control/visibility (even if deferred) · archive
cascade + rollup exclusion · exact depth cap + enforcement on create AND reparent · corrected blast radius +
tree×groupBy + bulk-select semantics · sprint/attachment data semantics if kept.

## Cut candidates for v1 (8)
The recursive rewrite itself · OKRs (Objective+KR) · Sprint entity+hook · Milestones · item-level Accept gate
· authored rich-text documents (a large sub-project — serialization/editor/sanitization) · task↔task any-level
dependencies · Task "In review" state + the "Plan" phase (Plan only exists to host the deferred layers).

## Recommendation — Option B
Ship the **§8 phase-lifecycle simplification on the existing flat 3-level model now** — the real ~80% win:
one manual task status, **execute-by-default, owner-closes-when-tasks-done, derived health**. Then return to
the **detail page** (the original task) on that model. Revisit the nested model only after resolving the
phase/status split, cycle-over-union rule, the mode entity, and total-function rollups in a *second* design
pass — ideally with real production evidence. The nested-model doc stays captured as that future direction.
