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

```
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

  -- lifecycle
  status        text  not null default 'pending',  -- pending | accepted | rejected | superseded | expired
  decided_by    text,             -- the human (users.id) who accepted/rejected
  decided_at    timestamptz,
  applied_write jsonb,            -- what actually happened on accept (the created id / the diff applied)

  -- provenance (see companion doc) — actor is the run/agent, on_behalf_of the human
  actor_type    text  not null default 'agent',
  on_behalf_of  text,
  created_at, updated_at
)
```

Indexes: `(tenant_id, status)` (the review inbox), `(run_id)` (a run's batch), `(target_type,target_id)`
(what's pending against this row — see §5 conflicts).

**Why `payload` is JSONB, not typed columns:** the target varies across modules (a work-item patch vs a
mode-config change). JSONB keeps the *table* generic; **the type safety lives at APPLY time** — the
apply path validates the payload against the target module's own contract/guard before writing. Untyped
storage, typed application. This is the same "generic container, typed enforcement" pattern the guard
layer already uses.

---

## 3. Lifecycle

```
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

## 4. Modes tie-in (the auto-accept dial)

The proposals queue is where **agent autonomy** (a mode setting, deferred but reserved) becomes concrete:
a mode declares how much review is required. `confidence` + mode policy decide whether a proposal needs
a human or auto-applies within bounds:

- **Jira-tight**: everything requires human accept.
- **Linear-default**: low-risk operations auto-accept; structural/config changes require review.
- **Notion-loose**: most auto-accept.

Auto-accept is still a *guarded* write (same apply path, provenance recorded) — never an unguarded
mutation. This is why modes and proposals were always coupled; the queue is the enforcement surface.

---

## 5. The hard parts

1. **Stale proposals (conflict).** A proposal is made against a target's state at run time; the human may
   accept minutes later after the target changed. At apply time, re-validate against *current* state
   through the guard; if the invariant no longer holds (e.g., the parent was deleted, the status moved),
   the accept **fails cleanly** with a "stale — regenerate" rather than force a bad write. `(target_type,
   target_id)` index surfaces "N pending proposals touch this row."
2. **Idempotency.** Accept must be exactly-once — a double-click can't apply twice. Status transition
   `pending→accepted` is the guard (atomic `UPDATE … WHERE status='pending'`).
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
5. **Confidence-threshold auto-accept** per mode — exact thresholds are a mode-tuning question, deferred
   with modes; the column is reserved so no migration is needed when modes land.
