# Work Item — Architecture (structural design, scope-agnostic) — v3, gaps folded in

> **⚠️ Superseded — exploratory design, not the shipped model.** Kept for design
> history. The build follows
> [`2026-07-05-work-item-port-plan.md`](2026-07-05-work-item-port-plan.md), which
> deliberately ships a lean subset (flat tasks + phase lifecycle; **no** nested
> containers, OKR/KeyResult, or KPI entities). The entities and invariants below are
> exploration, not a build contract.

The definitive **architecture** — correctness, coherence, extensibility (not scope/effort). v2 applied the
Fable soundness review (shape approved). **v3 folds in the six-vantage completeness sweep:** fixes the 3
internal inconsistencies and adds the 3 previously-missing layers (collaboration/presentation, multi-tenancy/
security, AI/async runtime) — all additive to the approved core shape. Companion: `...-model-RECOMMENDED.md`,
visual: `work-item-architecture-visual.html`.

## Architectural principles
1. **Graspable core.** Base = task + work item + status; everything else opt-in (Config).
2. **AI-woven, three modes.** *Config* · *Oversight* · *Agents* — all consumers of the core.
3. **Orthogonal axes.** Independent refs (scope, time, strategy); focus by view, never re-parent.
4. **Flat work spine.** Tasks never nest; only containers nest (`parentId`).
5. **Derived over stored, total.** Manual state only where a human must decide; health/completion/status are
   total functions (empty, terminal, and cancelled cases all defined).
6. **Upper layers are consumers.** Presentation, strategy, AI read the core; never complicate the base.
7. **Viewer-independent rollups.** Counts compute over the full child set; visibility hides detail, never counts.
8. **Every entity is tenant-scoped.** `tenant_id` on all rows; no reference crosses a tenant.

## Core entities (with v3 field fixes)

| Entity | Key fields | Notes |
|---|---|---|
| **Task** | `title`(req), `description?`, `status(todo/doing/done/cancelled)`, `kind`, `priority?`, `owner?`, `assignees[]?`, `createdBy`, `dueDate?`, `startDate?`, `estimate?`, `rank`, `labels[]`, `health(derived)`, `tenant_id`, `teamId?`, `createdAt/updatedAt`, `origin/sourceConnectionId?` | **dueDate added** (Invariant 3 now has a field). `cancelled` terminal added. `rank` = fractional index for manual ordering. `estimate` nullable, unit via Config. |
| **Work Item** | `title`(req), `description?`, `kind(version/release/project/initiative)`, `parentId?`, `owner`, `priority?`, `startDate?`, `targetDate?`, `completion%(derived)`, `state(open/done/cancelled)`, `tenant_id`, `teamId`, timestamps | Scope container. `startDate` for timeline bars. |
| **Milestone** | `title`, `startDate?`, `targetDate`, `status(derived)`, `tenant_id` | Alpha/Beta/GA inside a version. |
| **Cycle** | `start`, `end`, `teamId?`(null=global), `capacity?`, `autoRollover`, `tenant_id` | Sprint timebox; `capacity` for burndown. |
| **Owner** | `identityRef`, `name`, `initials?`, `tenant_id` | A principal. PII → erasure = pseudonymize (preserve rollup integrity). |

**completion% (Invariant fix):** **count-based in v1** (done ÷ non-cancelled children); effort-weighted when
estimates present (Config-gated). Empty = n/a; cancelled excluded.

## Layer O — Org & platform substrate

| Entity | Key fields | Notes |
|---|---|---|
| **Tenant / Organization** | `id`, `name` | Root; owns Teams, Owners, Connections, Configs. `tenant_id` on every entity references it. |
| **Team / Workspace** | `id`, `name`, `tenant_id` | Anchor for Config, Cycle scope, Connection ownership, cross-team predicates. |
| **Membership** | `principal`, `teamId`, `role(viewer/member/admin/owner)` | Foundation (not a deferred feature). Basis for authorization. |
| **Jobs / Scheduler** | queue · worker · cron | Runtime peer of the repository seam; runs rollover, auto-create-cycle, Oversight sweeps, Connection sync, notifications. |

## Layer P — Collaboration & presentation (consumers of the core)

| Entity | Key fields | Notes |
|---|---|---|
| **View / SavedView** | `ownerScope(user/team)`, `filter`, `groupBy`, `sortBy`, `visibleFields[]`, `layout(board/list/timeline)`, `isDefault`, `name` | The "two lenses" made persistable; `rank` is view-context ordering. |
| **ActivityEvent** | `actor`, `action`, `(targetType,targetId)`, `field`, `from→to`, `at`, `diff` | **Append-only audit** written at the repository seam (can't be bypassed); generalizes RolloverEvent. Backs the detail feed + all time-series metrics (burndown, cycle-time, lead-time) + compliance audit. |
| **Comment** | `author(Owner\|AgentRun)`, `body`, `(targetType,targetId)`, `at`, `resolved?`, `parentCommentId?`, `mentions[]` | Discussion + @mentions over the bounded polymorphic target set. |
| **Label** | `name`, `color`, `tenant_id` | `Task/WorkItem ↔ Label` join; primary cross-cutting filter. |
| **Subscription** | `principal`, `(targetType,targetId)`, auto-rules | Watchers; drives notifications. |
| **Notification** | `recipient`, `event(ref)`, `channel`, `readState` | Derived from state transitions + Flag/AgentRun emissions. |
| **UserPreference / Favorite** | per-Owner: default view, theme, notif settings; starred items | Personalization home. |

## Layer AI — AI & integration runtime

| Entity | Key fields | Notes |
|---|---|---|
| **Config** | enabled axes, cadence, field visibility, `version`, `authoredBy`, `supersedes?` | Per team; versioned like Decision. |
| **Agent** (definition) | `instructions`, `model`, `tool/Connection allowlist`, `scope`, `version` | Registry, versioned. Distinct from a run. |
| **AgentRun** | `agentId`, `(targetType,targetId)`, `mode(plan/review/act)`, `status(queued/running/succeeded/failed/cancelled)`, `launchedBy`, `startedAt/finishedAt`, `params`, `cost/tokens`, `error`, `trace`, `turns[]?` | Full lifecycle; produces Attachments + a conversation. |
| **Oversight / OversightPolicy** | trigger(event+debounce), bounded periodic sweep, per-team cost budget, dirty-set | Continuous process emitting **Flags**; model/prompt version stamped. |
| **Flag** | `(targetType,targetId)`, `raisedBy`, `severity`, `audience(owner\|team)`, `state(open/resolved/overridden)`, `dedupKey(target+ruleId)`, `resolvedByDecisionVersion?`, `createdAt` | Inbox-ready (audience+severity+age); auto-resolve on condition-clear; `overridden` feeds Oversight-precision signal. |
| **Connection + sync** | external ref, `ownerTeamId`, **encrypted credential ref (KMS)**, granted scopes, `authorizedBy`, expiry/refresh, revocation; `syncMode(webhook/poll)`, cursor, retry/dead-letter | Agents act *through* these. **ExternalRef** map (external PR ↔ internal task). |
| **act-mode guardrails** | dry-run → diff → human approve; idempotency key; budget/concurrency caps; loop/depth detection; team/global kill switch | Required before any external write. |

## Strategy layer (unchanged from v2, with owners)
`Objective`(+owner), `KeyResult`(+`checkIns[]` append-only: value, at, confidence, note), `Decision`
(versioned, `authoredBy`). Bounded polymorphic targets (`Decision/Flag/Comment/AgentRun/Attachment`) use
`(targetType,targetId)` over a server-enforced enumerated set.

## Invariants
1. **Acyclic union** — dependency (`A→B` = "A waits on B") + containment-derivation (`container→member`) edges
   acyclic; no unit depends on an ancestor; transactional server-side.
2. **Axis cardinality** — ≤1 scope, ≤1 cycle per task (`UNIQUE(taskId)` edge tables).
3. **Health total** — leaf `blocked` = incomplete dependency, `at_risk` = past **`Task.dueDate`** (now exists) or
   defined trigger; **`done` and `cancelled` are terminal** (excluded from blocked/at_risk); container =
   `worst(intrinsic incl. own targetDate, worst-child)`; full-depth; carriers Work Item + Milestone; empty = "no work".
4. **Close continuous** — `ready-to-close` (derived, non-cancelled children done) + owner confirm; attaching a
   non-done task to a done item reverts it to open; cancelled children excluded.
5. **Single alignment path** — `objectiveId`+`keyResultId` consistent; task overrides container; `KR.current` is source of truth.
6. **Versioning** — Decision & Config supersede-chains injective, acyclic, one head; `authoredBy` recorded.
7. **Config default** — simplest default; absence = base; disabling an axis hides refs, never deletes.
8. **Referential integrity** — every ref valid or null; deletes cascade-null/block/tombstone (incl. polymorphic);
   archived excluded from rollups.
9. **Tenant isolation** — every entity carries `tenant_id`; **every reference shares the referrer's `tenant_id`**;
   enforced at the repository seam alongside acyclicity. (No cross-tenant Decision/dependency/Attachment.)
10. **Authorization** — capability by role (`viewer/member/admin/owner` → `read/edit/close/override/configure/
    connect/launch-agent`), scoped by Tenant/Team; enforcement may ship later but the shape is committed now.
    Rollups stay viewer-independent; aggregate-inference stance: **aggregates over unreadable children are
    suppressed** (not silently counted per-viewer).

## Layered structure (dependency downward)
```text
  ┌─ AI & Integration ─ Config · Agent · AgentRun · Oversight · Flag · Connection+sync
  ├─ Presentation ───── View · ActivityEvent · Comment · Notification · Subscription · Label · UserPref
  ├─ Strategy ──────── Objective/KeyResult · Decision
  ├─ Axes ──────────── Scope (WorkItem kinds, parentId) · Time (Cycle)
  ├─ Org & platform ── Tenant · Team · Membership · Owner(principal) · Jobs/Scheduler
  └─ Core ──────────── Task · dependencies · derived health   ← still runs alone
```

## Extension seams
- New scope/task kind = enum value; new container nesting = `parentId` policy.
- New axis = one `UNIQUE(taskId)` edge + container table, per the **axis contract** (ref, rollup fn, health
  participation, Config toggle, disable semantics). KRA lands here later (a person-responsibility axis on Owner/Team).
- New AI capability = a new `AgentRun.mode` or Oversight rule emitting `Flag`s.
- **Custom fields** = a `FieldDefinition` + value table (deferred; the seam is Config-gated visibility today).
- Repository seam mediates all access + writes ActivityEvent + enforces Invariants 1, 8, 9, 10.

## Deliberately deferred (documented, not missed)
Roadmap/timeline as derived-view-first (not a new entity); templates/recurring work; typed non-dependency
relations (relates-to/duplicates); SSO/SCIM + guest sharing (shape noted, build later); data-residency.
Predecessor fields `source/provenance` → folded into `Task.origin`; `department` → superseded by `Team`.
