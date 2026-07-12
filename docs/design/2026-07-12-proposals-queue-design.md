# Proposals Queue — Design

**Date:** 2026-07-12
**Status:** PROPOSED — awaiting founder review.
**Companion:** [actor-provenance-design](2026-07-12-actor-provenance-design.md) (proposals carry
provenance; they are two halves of one story).
**Why now:** `proposals` is load-bearing for **three** unbuilt features — agent-driven config, the
meeting promote-flow, and general agent writes — and has zero design (prose only). Fable's warning:
spec it against **both** consumers up front, or the first one to ship warps its shape and the second
needs a migration.

**The one-line definition.** A **proposal** is *a reviewable intent to change something* — an actor
(usually an agent) wants to make a change, and it lands in a queue for a human to accept, reject, or
edit **before** it is applied. It is the guard rail that makes agent writes safe: **agents propose;
humans dispose.** Nothing an agent does mutates real data without either a human accept or an explicit
mode that auto-accepts within bounds.

**Design principle — module-agnostic by construction.** A proposal must be able to target *any* entity
in *any* module (a work Item, a Check, a meeting action-item, a board's mode/config), or module #5 will
need its own parallel queue. One table, one lifecycle, one review surface, one apply path.

---

## 1. The two consumers it must fit from day one

Fable's instruction: design against both, so neither warps it. They differ in *what* they change, which
is exactly the axis the schema must generalize.

**Consumer A — agent-driven config (agent-first setup / modes).**
"Describe your project → the agent configures the board within guard rails." The agent proposes
**structural/config changes**: set the team's mode, add a status, change required fields, adjust the
workflow. Target = a *config object* (team/mode/status). Operation = `update_config` / `create_status`.
Reviewed as "here's how I'd set up your board — approve?"

**Consumer B — the meeting promote-flow.**
A meeting extracts action items. Each extracted action item is a **proposal to create a work Item**
(source='meeting', provenance=the run). Target = a *new work_item*. Operation = `create`. Reviewed as
"turn these 4 action items into board Items — which do you want?"

**Plus the general case (thin agent slice):** an agent asked to triage/edit proposes `update` /
`create` / `add_dependency` on work Items.

The generalization that fits all three: a proposal names **(target_type, target_id?, operation,
payload)** and does not care which module it belongs to. Config-changes and data-writes are just
different `operation`s over different `target_type`s.

---

## 2. Schema

```text
proposals(
  id            uuid pk,
  tenant_id     text  not null,                 -- scoped like every table
  run_id        uuid  references agent_runs(id), -- the run that produced it (nullable: human-drafted)

  -- WHAT it wants to change (module-agnostic)
  target_type   text  not null,   -- 'work_item' | 'check' | 'dependency' | 'team_config' | 'status' | …
  target_id     uuid,             -- the row to change; null for a create
  operation     text  not null,   -- 'create' | 'update' | 'delete' | 'update_config' | 'add_dependency' | …
  payload       jsonb not null,   -- the proposed values / diff (validated at APPLY time, not trusted)

  -- WHY / for the human
  rationale     text,             -- the agent's one-line "why" (shown in review)
  confidence    real,             -- optional agent self-score, for ranking/auto-accept thresholds

  -- optimistic concurrency (see §5.1 stale detection)
  target_version bigint,          -- the target row's version/xmin snapshot at propose time; null for a create

  -- lifecycle
  status        text  not null default 'pending',  -- pending | accepted | rejected | superseded | expired | applied
  decided_by    text,             -- the human (users.id) who accepted/rejected = the APPROVER
  decided_at    timestamptz,
  applied_write jsonb,            -- what actually happened on accept (the created id / the diff applied)

  -- provenance (see companion doc) — the SAME actor_* shape as every write table
  actor_type    text  not null,   -- 'agent' (run-produced) | 'human' (human-drafted). NO default: set explicitly.
  actor_id      text  not null,   -- run_id when actor_type='agent'; users.id when 'human'
  on_behalf_of  text,             -- the TRIGGERER (users.id) for agent proposals; null for human-drafted
  created_at, updated_at
)
```

**Allowed provenance combinations (enforced, not conventional):**

| `actor_type` | `run_id` | `actor_id` | `on_behalf_of` | who drafted it |
|---|---|---|---|---|
| `agent` | **not null** (the run) | = `run_id` | the triggering human | an agent run |
| `human` | null | the user's id | null | a person, by hand |

`actor_type` has **no default** (the prior `default 'agent'` was wrong — a human-drafted proposal has
`run_id` null yet would have been mislabeled `agent`). `actor_id` is required and mirrors the companion
provenance shape, so a proposal is never anonymous. `on_behalf_of` on the proposal is the **triggerer**;
the **approver** is `decided_by` — the two are distinct humans (companion §4).

Indexes: `(tenant_id, status)` (the review inbox), `(run_id)` (a run's batch), `(target_type,target_id)`
(what's pending against this row — see §5 conflicts).

**Why `payload` is JSONB, not typed columns:** the target varies across modules (a work-item patch vs a
mode-config change). JSONB keeps the *table* generic; **the type safety lives at APPLY time** — the
apply path validates the payload against the target module's own contract/guard before writing. Untyped
storage, typed application. This is the same "generic container, typed enforcement" pattern the guard
layer already uses.

---

## 3. Lifecycle

```text
            (agent run emits)
pending ───────────────────────────────► accepted ──► applied (real write, via the guard/recordWrite path)
   │                                          
   ├── human rejects ──► rejected            
   ├── human edits then accepts ──► accepted (payload updated, decided_by set)
   ├── a newer proposal on the same target ──► superseded
   └── TTL passes without decision ──► expired
```

- **Accept** is the only path that mutates real data, and it goes through the **same guard/`recordWrite`
  layer** as human writes — so tenant scoping, invariants, and provenance all apply. An agent's accepted
  proposal is not a privileged back door; it is a normal guarded write stamped `actor_type='agent',
  on_behalf_of=the approver` (companion doc §4).
- **Edit-then-accept** is first-class: the human tweaks the `payload` before accepting. The record shows
  the agent proposed X, the human applied X′.
- **Batch review**: a run's proposals share `run_id` and are reviewed together ("accept all / pick").

---

## 4. Modes tie-in (the auto-accept dial) — DEFERRED

> **v1 DECISION (founder, 2026-07-12): review everything.** The first thin agent slice ships with
> **no auto-accept** — every proposal, regardless of confidence or operation, requires an explicit human
> accept. We prove the propose→review→accept loop (and that it *feels* right) before adding the
> complexity of deciding which proposals may skip review. The `confidence` column and the mode hooks
> below are **reserved** so auto-accept lands later with modes and needs no schema change.

The proposals queue is where **agent autonomy** (a mode setting) *will* become concrete when modes ship:
a mode declares how much review is required, and `confidence` + mode policy decide whether a proposal
auto-applies within bounds. The intended future dial:

- **Jira-tight**: everything requires human accept. **(= today's v1 behavior for all modes.)**
- **Linear-default**: low-risk operations auto-accept; structural/config changes require review.
- **Notion-loose**: most auto-accept.

Even then, auto-accept is still a *guarded* write (same apply path, provenance recorded) — never an
unguarded mutation. This is why modes and proposals were always coupled; the queue is the enforcement
surface. Until modes ship, **all modes behave as Jira-tight (review everything).**

---

## 5. The hard parts

1. **Stale proposals (conflict).** A proposal is made against a target's state at run time; the human may
   accept minutes later after the target changed. Two layers guard this:
   - **Optimistic-concurrency check.** The proposal captures the target's version at propose time in
     `target_version` (a monotonic row version — a `version` column we bump on write, or the row's
     `xmin`/`updated_at` snapshot). At apply time, the guarded write is conditioned on the version being
     unchanged (`… WHERE id = :target_id AND version = :target_version`). If it moved, the target was
     edited since — the accept **fails cleanly** as "stale — regenerate" rather than clobbering the newer
     state. (Creates have no target, so `target_version` is null and this check is skipped.)
   - **Invariant re-validation.** Independently, re-run the target module's guard against *current* state
     (the parent may have been deleted, the status moved) so an accept never forces a write that violates
     an invariant even if the version happened to match.

   `(target_type, target_id)` index surfaces "N pending proposals touch this row."
2. **Exactly-once apply (idempotency + crash-safety).** A `pending→accepted` status flip followed by a
   *separate* write is **not** exactly-once: a crash between them leaves a proposal marked accepted but
   never applied, and a naive retry can apply twice. So the apply is **one transaction** that does both:
   ```text
   BEGIN
     UPDATE proposals SET status='applied', applied_write=…, decided_by=:approver, decided_at=now()
       WHERE id=:id AND status='pending'          -- 0 rows ⇒ already handled ⇒ no-op, COMMIT
     <the guarded recordWrite to the target, version-checked per §5.1>
   COMMIT                                          -- both land or neither does
   ```
   The `WHERE status='pending'` makes a double-click / retry a no-op (idempotent), and because the status
   transition and the real write commit in the **same** transaction there is no crash window where one
   happened without the other. (`sql.transaction()` on the Neon driver gives this; §7.2.) The lifecycle
   distinguishes `accepted` (decision recorded) from `applied` (write committed) — but under this
   single-transaction apply they flip together, so a stuck `accepted`-but-unapplied row cannot occur.
3. **Ordering within a batch.** A run may propose "create Item, then add a dependency to it." Accepting
   out of order breaks. Either apply a batch as an ordered unit, or make later proposals reference
   earlier ones by proposal-id and resolve on apply. Start: apply a batch in creation order, stop on
   first failure, report.
4. **Config vs data payloads share a table but not a validator.** Enforced at apply time by dispatching
   on `target_type` to that module's guard — the generic table never validates payloads itself.

---

## 6. Migration & sequencing

- Ships in / right after the **hardening PR** (needs `agent_runs` + provenance from the companion doc).
- Additive: `CREATE TABLE proposals` + indexes. No backfill (new concept).
- **First real consumer = the thin agent slice** (agent proposes work-Item changes) — proves the table
  against the *general* case. **Second = meeting promote** (create-Item proposals). **Third = agent
  config** (config proposals). Building the general case first is deliberate: it exercises the generic
  shape before either specialized consumer can warp it.

---

## 7. Open questions

1. **`target_type` registry** — a hardcoded enum, or an open string with per-module apply handlers
   registered in code? Recommend open string + a handler registry (keeps the table module-agnostic; a
   new module registers its apply handler without a schema change — the expandability test).
2. **Proposal ↔ multiple writes.** Some operations fan out (promote one action-item = create Item +
   link to meeting + set source). One proposal → a small transaction at apply. Confirm the apply path
   uses `sql.transaction()` (available; see the earlier driver correction).
3. **Review UX surface** — a dedicated inbox, inline on the target, or both? (Product; the schema
   supports any.)
4. **Retention** of decided/expired proposals — audit value vs table growth. Keep decided proposals
   (they're the audit trail with provenance); archive expired after N days.
5. **Confidence-threshold auto-accept** per mode — **DECIDED (2026-07-12): deferred.** v1 reviews
   everything (§4); auto-accept and its thresholds land with modes. The `confidence` column is reserved
   so no migration is needed then.
