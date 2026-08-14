---
name: memory-brain
description: >
  Work on Product-Suite's memory brain — the decision and knowledge store behind agent chat
  (the `memories` table, capture, reflection, injection/ranking, proposals, knowledge base).
  Leads with the one finding that changes what you should do: CAPTURE is the bottleneck, not
  retrieval. Count rows before optimizing anything — as of 2026-07-24 `memories` held 0 rows
  across 0 tenants with 7 agent_runs, which made a shipped injection-ranker fix moot. Use
  when the task mentions memory brain, remembering decisions, agent memory, capture or
  reflection, injection or the ranker, memory proposals, holdout or measurement, the
  knowledge base, or "why doesn't the agent remember X". Also use before filing or picking up
  any memory-brain issue, to check whether the layer below it is actually populated. NOT for
  the Forge kernel's own `forge remember` / `forge recall` project-memory notes (that is the
  `memory` skill), NOT for the user's harness-level memory files, and NOT for ordinary
  database schema mechanics (that is db-migrate).
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
---

# memory-brain

## Read this before you optimize anything

**Capture is the keystone. Retrieval is not the bottleneck.**

On 2026-07-24 the `memories` table held **0 rows across 0 tenants**, with 7 `agent_runs`.
An injection-ranker improvement had already been designed and partly built against that
empty store — it could not have changed any outcome. Reflection had no trigger wired, so
nothing was ever written.

So the first move on any memory-brain task is to **count**:

```sql
select count(*) from memories;
select count(distinct tenant_id) from memories;
select count(*) from agent_runs;
select type, count(*) from memories group by type;
```

Report the numbers. If capture is still empty, say so and fix capture — do not ship
ranking, scoring, or retrieval work on top of an empty table, however well-specified the
issue is. Re-check the counts even if an issue says the store is populated; that claim
goes stale.

## The model

One `memories` table holding three kinds — **decision | fact | rule** — plus:

- **supersession** (a memory replaces an earlier one rather than mutating it)
- **provenance** (where it came from, always)
- **scope** (what it is about, and it cascades)
- **ownership/visibility** (who may see it — `private` requires an owner, `org` forbids
  one; a DB CHECK, not a convention, so it fails closed)
- **topics and time**

Phasing, as locked: P1 leads with decisions and knowledge. P2 is the procedural moat plus
a holdout for measurement. P3 is the knowledge base on pgvector.

## Vocabulary

The user's word is **memory brain**. *Capture*, *injection*, *reflection*, *proposal*,
*holdout*, *ranker* are **our** engineering words — correct in code and in issues, wrong
in a UI label or in a summary written back to him.

## Working on it

- Schema changes go through the **db-migrate** skill — the memory tables are in
  `packages/db/src/schema.ts` and the ownership axis landed in
  `0016_memory_ownership_axis.sql`. Read that migration's header comment; it explains why
  visibility is a separate axis from scope and why the CHECK is biconditional.
- Privacy is enforced at the database, not in application code. A nullable flag fails open
  on every path that forgets it. Do not move that boundary up into TypeScript.
- Attribution is only recoverable going forward. If a change would make early runs
  unattributable, do it now rather than "later" — retrofitting permanently loses the cohort.

## Trust loop

The P2a deliverable is a trust loop, not a feature: observe → propose a rule with its
evidence → human approves with a strength → apply → revoke if it stops earning its place.
Enforcement is per-rule and advisory by default. Access to a trace is not the same as
compliance with it — measure whether a rule changed behaviour, don't assume it did.

## Related

- Root `AGENTS.md` §5 (glossary), §7 (hit every surface)
- `db-migrate` skill — any schema change here
