# Actor Provenance — Design

**Date:** 2026-07-12
**Status:** PROPOSED — awaiting founder review.
**Feeds:** the hardening PR (adds provenance columns before any agent writes exist).
**Why now:** we are about to build the first agent writes. Once agents mutate data, we need to know
*who did it* — human, agent, or agent-on-behalf-of-a-human — for attribution, audit, and undo. Adding
`actor_*` columns across every write table **after** agents ship is a retrofit across the whole schema;
adding them now, while there is no data to backfill and no traffic, is nearly free. (Fable flagged this
as the risk most likely to bite in 3 months.)

**Design principle — uniformity is the point.** This is not a workboard feature. Every table an agent
could ever write carries the *same* provenance shape, written through *one* helper, so module #5 gets
attribution for free instead of re-inventing it. If provenance is per-table one-offs, it will drift.

---

## 1. The actor model

Every mutation is attributable to an **actor**. There are four kinds:

| `actor_type` | Meaning | `actor_id` | `on_behalf_of` | `run_id` |
|---|---|---|---|---|
| `human` | a person acting directly in the app | the user's id | null | null |
| `agent` | an agent acting **for** a human (the common case) | the agent/run identity | the human who triggered it | the run |
| `system` | platform automation (schedulers, migrations, webhooks) | a system identity | null | maybe |
| `import` | a migration/import (Jira/Linear) | the import job | the human who ran it | null |

The load-bearing distinction is **`agent` with `on_behalf_of`**: an agent write is *never* anonymous —
it always records the human who authorized the run. This is what makes "undo everything the agent did
in run X" and "this change was proposed by the agent, approved by Priya" expressible.

`import` reuses this instead of the existing `work_items.source='import'` hack — `source` stays
*provenance-of-origin* (meeting/agent/feedback), while `actor_*` is *who performed this specific write*.
They answer different questions and both are kept.

---

## 2. Machine identity — the hard part

**Clerk gives us human identity only.** An agent run is not a Clerk user, so it needs its own scoped,
short-lived credential — we do **not** reuse a human's Clerk token for agent writes (that would make
every agent action indistinguishable from the human, defeating provenance and widening the blast radius
of a leaked token).

**Design: Workers mint per-run agent tokens.**

1. A human triggers an agent run (chat message or "run this"). The request carries the human's verified
   Clerk identity → resolves to `{tenant_id, user_id}` via the existing `callerTenantIds` path.
2. A Worker mints a **short-lived, signed agent-run token** whose claims are
   `{ tenant_id, run_id, on_behalf_of: user_id, scope, exp }` — scoped to exactly one tenant, one run,
   a bounded capability `scope`, and a short TTL (minutes, renewable while the run is active).
3. Every write the agent makes presents that token. The write path verifies it (same middleware shape as
   Clerk verification), and stamps `actor_type='agent'`, `actor_id=run_id`, `on_behalf_of=user_id`,
   `run_id=run_id`. The token's `tenant_id` is the tenant guard — an agent can **never** widen scope
   beyond the tenant/run it was minted for, even if its own reasoning goes wrong.

This means an agent's authority is *strictly a subset* of the human's, time-boxed and run-boxed. It is
the machine-identity answer the vision doc left open ("machine identity + scoped agent tokens are
unsolved").

> **Open:** the token minter/verifier is small but new. Candidates: a signed JWT the Worker issues and
> verifies (no new dependency, symmetric or asymmetric key), or Clerk M2M if it fits the per-run,
> short-lived shape. Lean JWT — see §7.

---

## 3. Schema

### 3.1 The `agent_runs` table (a run is first-class)

A run is a real entity — it has a lifecycle, an owner, a status, and everything it did links back to it.

```
agent_runs(
  id            uuid pk,
  tenant_id     text  not null,            -- the org, scoped like every table
  triggered_by  text  not null,            -- the human (users.id) = on_behalf_of
  kind          enum  (chat | agent_run),  -- the two invocation modes (one plane)
  status        enum  (running | completed | failed | canceled),
  summary       text,                      -- what it did (for the activity feed / audit)
  created_at, updated_at
)
```

### 3.2 Provenance columns — uniform, on every write table

Added to `work_items`, `checks`, `work_item_dependencies`, `projects`, `teams`, `statuses`,
`activity_events`, and the future `proposals` and meeting tables. Same five columns, same helper:

```
actor_type    enum (human | agent | system | import)  not null default 'human'
actor_id      text  not null            -- users.id | run_id | system id
on_behalf_of  text                      -- users.id when actor_type='agent'/'import', else null
run_id        uuid  references agent_runs(id) on delete set null   -- when part of a run
-- (created_at already exists everywhere; it doubles as "when")
```

- **Backfill is trivial**: existing rows → `actor_type='human'`, `actor_id` = whatever created them (or
  a legacy sentinel where unknown). No traffic, tiny data.
- **Default `'human'`** so existing app write paths keep working unchanged until they're threaded through
  the provenance helper; agent/import paths set it explicitly.

### 3.3 One write helper — the enforcement point

A single `recordWrite(sql, table, values, actor)` in the guard/policy layer (the same centralized module
Fable prescribed for invariants) stamps the `actor_*` columns from the verified token/claims. Endpoints,
the promote-flow, and agent writes all call it. Provenance is *impossible to forget* because the write
path requires an `actor`. This is the uniformity mechanism.

---

## 4. How it composes with proposals

Provenance and the proposals queue are two halves of the same story:

1. An agent run produces a **proposal** (not a direct write). The proposal row carries the run's
   provenance: `actor_type='agent'`, `on_behalf_of`=the triggering human, `run_id`.
2. A human **reviews and accepts** it. The resulting *actual* write records `actor_type='agent'`,
   `on_behalf_of`=**the approver**, `run_id` — so the audit trail shows *both* "the agent proposed it"
   (on the proposal) and "Priya approved it" (on the write). Accountability is complete.
3. **Undo-by-actor / undo-by-run** falls out for free: "revert everything run X wrote" = the set of rows
   with that `run_id`.

This is why provenance ships in the hardening PR *before* the proposals kernel: proposals need somewhere
to record who-and-which-run from day one.

---

## 5. What this buys (and the expandability payoff)

- **Attribution** — every row answers "who changed this, human or agent, on whose authority."
- **Audit** — a per-tenant, per-run activity trail without bolting on a separate audit system.
- **Undo-by-run** — the safety net that makes users comfortable letting agents write at all.
- **Blast-radius control** — a leaked agent token is scoped to one tenant + one run + a short TTL.
- **Module-agnostic** — a new module inherits attribution by calling `recordWrite`; nothing per-table to
  design. This is the "does module #5 plug in without a rewrite?" test, passed.

---

## 6. Migration (in the hardening PR, additive)

1. `CREATE TABLE agent_runs` (+ enums).
2. `ALTER TABLE … ADD COLUMN actor_type … default 'human'`, `actor_id` (backfill from creator/sentinel →
   `SET NOT NULL`), `on_behalf_of` (nullable), `run_id` (nullable FK) — on each write table.
3. Backfill existing rows to `human` / legacy sentinel.
4. Route the existing write paths through `recordWrite` (behavior unchanged — they stamp `human`).

Additive, backfill-safe, zero-downtime — the same expand/contract discipline as the ontology wave.

---

## 7. Open questions

1. **Token mechanism** — signed JWT minted+verified by our Workers (lean, no new vendor, fits the
   per-run short-lived shape) vs Clerk M2M. Recommend JWT; confirm.
2. **`scope` granularity** — coarse (`write:workboard`) now, finer (`write:work_items:create`) later?
   Start coarse; the column allows tightening without migration.
3. **`system` identity** — a single reserved system actor id, or per-automation ids? Start with one.
4. **Retention / undo window** — how long is a run's write-set undoable? (Product question; the data
   supports any policy since `run_id` persists.)
5. **Provenance on `checks`/high-volume rows** — five columns × many checklist rows is cheap, but confirm
   we want per-Check provenance vs inheriting the parent Item's. Recommend per-row (checks can be
   agent-created independently).
