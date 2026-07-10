# How deep should issue nesting go? Evidence review

Date: 2026-07-10. Question: 1 level, ~3 levels, or unlimited — and what does real-world evidence say?

Every factual claim below has a URL. Claims marked **[snippet-only]** come from search-result summaries not opened directly and should be re-verified before being quoted externally. Reasoning is labeled as reasoning.

> **Provenance note (2026-07-10):** this file was lost to a cross-session `git clean` and restored from the research agent's original output. Content unchanged.

---

## 1. Evidence table — vendors' actual limits

| Vendor | Documented depth | Changed over time? | Sentiment / source |
|---|---|---|---|
| **Jira** | Epic → Story/Task → Sub-task. A sub-task cannot have sub-tasks. Premium "Plans" adds levels **above** epic only; you cannot insert a level below epic or below sub-task. | **Deliberately refused.** JRASERVER-4446 closed **Won't Do** (Atlassian, 6 Nov 2017). Support-reference count 19. | Atlassian: *"we are not planning to invest in more extensive issue hierarchies… we strongly believe that we should focus on making Jira simpler and easier to use rather then introduce additional complexity on both conceptual and technical level."* ([JRASERVER-4446](https://jira.atlassian.com/browse/JRASERVER-4446)); hierarchy-above-epic-only ([docs](https://support.atlassian.com/jira-software-cloud/docs/configure-custom-hierarchy-levels-in-advanced-roadmaps/)) |
| **Linear** | Sub-issues nest; the docs **do not state** a depth cap (undocumented, not "unlimited"). Separately, **initiatives** are explicitly capped at **five levels**. | Yes — sub-initiatives shipped 10 Jul 2025 *with* a 5-level cap. | *"Initiatives can now be nested up to five levels deep"* ([changelog](https://linear.app/changelog/2025-07-10-sub-initiatives)); [issue docs](https://linear.app/docs/parent-and-sub-issues) |
| **Asana** | Subtasks nest (users describe it as "endless"). | No change found. | Asana's **own blog tells you not to use it**: *"we recommend not going more than a single 'layer' deep"* ([Asana](https://blog.asana.com/2020/11/asana-tips-subtasks/)). Users ask Asana to **add a cap**: *"my clients and teams can create endless sub-tasks on simple projects that don't need them… I rarely see a need for more than 3 levels"* ([forum](https://forum.asana.com/t/limit-sub-task-depth/8510)) |
| **ClickUp** | Up to **7** levels of nested subtasks, **default 3**, admin-configurable. Max **1,000** subtasks per task including nested. | Yes — shipped as an opt-in ClickApp with a conservative default. | [ClickUp docs](https://help.clickup.com/hc/en-us/articles/6304431740055-Create-nested-subtasks) |
| **GitHub Issues** | **8** levels of nested sub-issues, **100** sub-issues per parent. | Sub-issues are new (2024–25); the cap shipped with the feature. | [GitHub docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) |
| **monday.com** | **Up to 4 levels** of subitems — **only on newly created "multi-level" boards**. | **Yes — raised from 1 level.** *"You asked, we delivered… subitems of subitems are finally here!"* | [monday docs](https://support.monday.com/hc/en-us/articles/29810815287570-Multiple-levels-of-subitems-on-monday-com) |
| **Notion** | Sub-items nest; **no depth cap stated in the help doc**. The doc instead exposes display modes (`Nested in toggle` / `Flattened list`) and filter modes (`Parents only` / `Parents and sub-items` / `Sub-items only`). | Not established. | [Notion docs](https://www.notion.com/help/tasks-and-dependencies) |
| **OpenProject** | Parent/child work-package hierarchy; **no depth limit found in the docs I checked**. | Not established. | [OpenProject docs](https://www.openproject.org/docs/user-guide/work-packages/work-package-relations-hierarchies/) |
| Height, Shortcut, Plane | **Not verified** — see §6. | — | — |

### The strongest signals

1. **Jira restricted and stayed restricted for 20+ years**, in writing, on complexity grounds. Their escape valve was *upward* hierarchy and third-party apps, never downward.
2. **monday.com went the other way — and could not retrofit.** Multi-level subitems are *"only available on newly created boards."* Raising a depth cap was not a config flip; it needed a new board type ([monday docs](https://support.monday.com/hc/en-us/articles/29810815287570-Multiple-levels-of-subitems-on-monday-com)).
3. **ClickUp cannot enforce a *lowered* cap on existing data.** *"When you reduce the number of subtask levels, any existing nested subtasks are not impacted."* Deep trees survive; you only stop new ones ([ClickUp docs](https://help.clickup.com/hc/en-us/articles/6304431740055-Create-nested-subtasks)). **Lowering a cap is effectively impossible.**
4. **Asana allows it and advises against it.** The vendor's own guidance is 1 level.

---

## 2. Failure modes of DEEP nesting (each with a source)

- **Children are invisible in views by default.** Asana, in its own words: *"Unlike tasks, subtasks don't show up on Timeline or Calendar View. And while you *can* select a drop-down to show subtasks in List and Board View — subtasks don't show up by default in those project views, either."* Also excluded from Workload and Rules. ([Asana](https://blog.asana.com/2020/11/asana-tips-subtasks/))
- **Nested children can't be rendered in flat table/board views.** GitHub shipped 8-level sub-issues, then users asked for a way to see them: *"if you view issues in a table, there is no way to create a view where you can see a parent issue, with it's sub issues showing in rows directly beneath it. You can group by parent issue. But then this doesn't work well for filtering and sorting."* — 11 comments, 46 votes, still **Unanswered**. ([GitHub discussion #161692](https://github.com/orgs/community/discussions/161692))
- **Filter semantics become a product decision you must ship.** Notion's sub-item docs must offer three filter modes (`Parents only`, `Parents and sub-items`, `Sub-items only`) and two display modes — and board/calendar/gallery views support *only* `Parents only`. Depth forces per-view semantics. ([Notion](https://www.notion.com/help/tasks-and-dependencies))
- **Conceptual + technical complexity, per the vendor.** Atlassian's stated reason for refusing. ([JRASERVER-4446](https://jira.atlassian.com/browse/JRASERVER-4446))
- **Users request a cap because teammates over-nest.** ([Asana forum](https://forum.asana.com/t/limit-sub-task-depth/8510))
- **Per-parent volume caps are needed anyway** — ClickUp 1,000 incl. nested; GitHub 100 per parent.
- **[snippet-only]** Parent completion hides incomplete descendants ([Asana forum](https://forum.asana.com/t/completed-task-with-incomplete-subtasks/51714)); large subtask lists force repeated "load more" and users report getting lost navigating back to the parent ([Asana forum](https://forum.asana.com/t/subtask-expansion-feedback-for-tasks-with-lots-of-subtasks/1103367)).

**Verdict:** "a task buried N levels deep is invisible" is **not a strawman**. It is documented by Asana itself, and it is the top open complaint on GitHub's newer, capped implementation. Notification storms, estimate double-counting, and drag-reorder complexity are plausible but I found **no direct evidence** — see §6.

---

## 3. Failure modes of TOO-SHALLOW nesting (each with a source)

- **Users abuse issue links as a fake hierarchy — and lose all hierarchy features.** Atlassian community, on wanting a bug under a sub-task: *"Using issue links is almost certainly the way to go here. The downside is that Jira doesn't understand issue links as parent/child relationships, and therefore doesn't give you hierarchy-related features."* ([community](https://community.atlassian.com/forums/Jira-questions/Is-there-a-way-to-create-a-bug-within-a-subtask-Do-not-want-to/qaq-p/1932633))
- **Users abuse labels and custom fields** to fake a level Jira won't give them. **[snippet-only]** ([community](https://community.atlassian.com/forums/Jira-questions/How-to-create-additional-Sub-task-types/qaq-p/2688274))
- **Users leave for third-party apps.** Atlassian itself points customers at the paid **Structure** plugin in the Won't Do notice ([JRASERVER-4446](https://jira.atlassian.com/browse/JRASERVER-4446)); JXL / "Hierarchy for Jira" occupy the same niche.
- **Users add a checklist as a pseudo-level below sub-task.** **[snippet-only]** — the recurring Atlassian-community workaround is *"use checklists to add one more hierarchy level below the subtask."* This is exactly the layer we already have.
- **Even paying customers can't fix it.** Jira Premium Plans adds levels *above* epic only; you cannot insert a level below epic. ([Atlassian docs](https://support.atlassian.com/jira-software-cloud/docs/configure-custom-hierarchy-levels-in-advanced-roadmaps/))
- **The demand is persistent.** JRASERVER-4446 accumulated a 19-customer support-reference count before its 2017 Won't Do, and Atlassian maintained a mirrored JRACLOUD-4446 for Cloud. (Creation date not verified.)

**Verdict:** shallow nesting produces *workarounds and app purchases*, not tool abandonment. Jira remained dominant for two decades with a 1-level sub-task rule. That is the single most load-bearing fact in this report.

---

## 4. Transfer analysis to our constraints — **this section is reasoning, not cited evidence**

**We already have a second level.** Our `tasks` table is a flat per-work-item checklist. Adding `parent_id` on work items with a **1-level cap** gives us: work item → child work item → checklist row. That mirrors Jira's *effective* shape (Story → Sub-task → checklist) — though note the checklist tier under a sub-task is a community workaround in Jira, not a documented native level (see line 53), so the analogy is practical, not exact. It is one tier richer than Asana's own recommendation. The Jira-community "use checklists as the extra level below sub-task" workaround is us, natively.

**What depth costs us specifically:**

- **Cycle prevention.** At depth ≤ 1 the *validity check* is cheap — `parent.parent_id IS NULL`, a single-row read, no recursion — whereas at depth 3 every move must walk ancestors. But **depth 1 does not by itself make cycles impossible under concurrency**: two moves A→B and B→A each check "is my proposed parent a root?", both read NULL under READ COMMITTED, both commit, and you get a 2-cycle (and two now-non-root rows). Closing that needs the same tool as the dependency guard — a write-time `WHERE NOT EXISTS` check plus SERIALIZABLE for the complementary-move race — not the depth cap. What the depth cap buys is a *cheaper* check and no recursive ancestor walk, not race-freedom.
  > **Correction, added post-hoc:** an earlier draft claimed "depth 1 makes the race impossible" and blamed the Neon HTTP driver for lacking transactions. Both were wrong: the race exists at depth 1 (above), and `sql.transaction()` supports isolation levels over HTTP (WebSockets give full interactive transactions on Workers). The depth-1 recommendation stands on the product evidence in §1–§3, not on this concurrency argument.
- **Reorder/move as single-statement CTEs.** Fine at depth 1 (recompute siblings under one parent). At depth 3, a move re-parents a whole subtree — the CTE must update every descendant's `depth`/`path`.
- **Rollups.** Depth 1 → `GROUP BY parent_id`, one index. Depth N → a recursive CTE per read, or a maintained rollup column with the fan-out invalidation problem. Progress ambiguity ("does a parent's own estimate count, or only its children's?") is a *product* question that only appears once you have grandchildren.
- **Import fidelity.** Jira sub-tasks are 1 level → **lossless**. Linear sub-issues nest deeper and Linear publishes no cap → a Linear import is **potentially lossy at any cap we pick**. The mitigation at depth 1: re-parent every descendant to the top-level ancestor and preserve the original parent id in a metadata column, so a later cap raise can *reconstruct* the tree. Do this on day one; it is cheap now and impossible retroactively if we discard the field.

**Asymmetry — the decisive argument.** The evidence says the two directions are not symmetric:
- **Raising** a cap: ClickUp raises/lowers it with a dropdown; Linear shipped 5-level initiatives as an additive feature. For us it is a validation constant + view work. Data already conforms.
- **Lowering** a cap: ClickUp's own docs admit they **cannot** — existing deep trees are grandfathered forever. monday.com raised depth but had to gate it to **new boards**, i.e. even raising is expensive if the *storage shape* changes.

So: ship the cap low, but ship the **storage shape** (a `depth` int column, a preserved `original_parent_external_id`) that a deeper tree would need. The trap monday fell into was a shape change, not a constant change.

---

## 5. Recommendation

**Cap at 1 level of `parent_id` on work items (a parent must itself have `parent_id IS NULL`), keep `tasks` as the checklist tier, and store `depth` + imported-parent lineage from day one so the cap can be raised to 3 later without a data migration.**

**Confidence: moderate-high (~75%).** It is what Jira enforced for two decades, what Asana explicitly recommends despite allowing more, and what ClickUp defaults to within one level.

**The strongest argument against it:** *we are a migration target, and Linear is our marquee source.* Linear sub-issues nest past one level and publish no cap, so every Linear import at depth 1 is visibly lossy on day one — the moment a user's tree flattens, we have broken the one promise a migration tool makes. Jira imports are clean; Linear imports are not. If Linear migrations are the primary acquisition channel, the correct cap is **3**, accepting the recursive-CTE and cycle-race cost, because import fidelity is a first-impression, one-shot property and depth is a slow-burn one. Note that this argument is decided by *who our importing users actually are*, not by the depth literature — and the mitigation (preserve original lineage, flatten with a visible banner) only partially defuses it.

> **Resolution adopted in design:** cap at 1 as a **mode policy**, not a schema constraint; importers bypass the cap and land trees at true depth. This defuses the counter-argument without paying the depth cost on native creation.

---

## 6. Could not verify / no evidence found

Stated plainly, not filled in:

- **Height, Shortcut, Plane** — no depth documentation retrieved. Unknown.
- **OpenProject** — hierarchy exists; **no stated depth limit found**. Unknown, not "unlimited."
- **Linear's issue-level depth cap** — the docs page describes sub-issues without stating any cap. The widely-repeated "5 levels" figure applies to **initiatives**, not issues. I found **no** authoritative statement of Linear's sub-issue depth limit.
- **Notion's depth cap** — third-party posts claim ~10 levels and recommend 2–3 for performance; **Notion's own help doc states no limit.** Treat the number as unverified.
- **Quantitative data** — I searched for the share of issues that have children and average real-world tree depth in Jira/Linear/GitHub workspaces. **No study, vendor report, or dataset found.** Nothing to report; do not let anyone cite a number here.
- **Notification storms, sprint/estimate double-counting, drag-reorder complexity** — commonly asserted, but I found **no** primary report tying them to nesting depth. Plausible; unevidenced.
- **Reddit / Hacker News threads** — searches surfaced no substantive r/jira, r/agile, r/projectmanagement, or HN thread on nesting depth. The vendor forums (Asana, Atlassian, GitHub) carried all the real signal.
- **A vendor that shipped deep nesting and then removed it** — the strongest possible evidence. **Does not appear to exist.** ClickUp made lowering *impossible*, which is the closest thing.

---

*Compiled 2026-07-10 from primary vendor documentation, vendor issue trackers, and vendor community forums.*
