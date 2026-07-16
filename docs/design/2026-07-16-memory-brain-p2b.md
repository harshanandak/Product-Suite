# Memory Brain P2b — the proof (10% holdout + measured "saved N edits")

> Scope: **P2b** is the *proof* half of P2 — a randomized holdout that lets us MEASURE (not guess) that injected memory reduces the human editing burden, and an honest surface for that number. Plus the deferred **"Rules active during this run"** attribution seam from P2a. Builds on P1 (#96), P1b (#97), P2a (#98). **No new migration** — `agent_runs.memory_holdout` and `run_memory_attributions.suppressed` were provisioned in P1 (0010).

## 1. Why a real holdout (the decision)

To claim "memory saved you N edits" *honestly*, we need a counterfactual: runs that genuinely lacked memory, to compare against. Evaluated across statistical validity and human cost:
- **Counterfactual-only (never withhold):** no memory-off run → no delta → the number would be a guess. Rejected as the mechanism.
- **Per-user/org cohort:** few independent units, confounded by between-user differences, and permanently degrades a whole cohort. Rejected (worse on both axes at our scale).
- **Per-run random ~10% (CHOSEN):** each run is an independent randomized trial → an unbiased causal estimate with maximum power. The UX cost is **bounded and reviewed** — a holdout run isn't a *wrong* result (the human reviews every proposal in the Inbox), it just means that one proposal may need more editing, which *is* exactly the quantity we measure. It never ships silently.

**Honesty guardrails (from the trust lens):** the rate is a config constant we can lower or zero once proven; the headline number appears ONLY when a two-proportion 95% CI on the effect clears zero (below that, the surface says *"measuring — not enough data yet"*, never a confident number); if memory is measurably HURTING (rules too broad), the surface says so plainly rather than hiding it as "no difference"; and it always shows the raw holdout-vs-treated comparison + cohort sizes so the figure is auditable.

## 2. What already exists (reused, no new schema)

| Rail | Where | Role in P2b |
| --- | --- | --- |
| `agent_runs.memory_holdout` bool | schema 0010 | Per-run holdout flag, set at mint |
| `run_memory_attributions.suppressed` bool | schema 0010 | Logs a counterfactual: what WOULD have injected on a holdout run |
| `insertAttributions(sql, ctx, entries)` | memory-retrieval.ts | Extend with a `suppressed` flag |
| `retrieveForContext` / `retrieveRulesForContext` | memory-retrieval.ts | Compute what would inject; the runtime decides inject-or-suppress |
| `mintRun` | runtime.ts:160 | Assign the holdout at run start |
| `proposals.run_id` + `.edited_payload` + `.status` | schema 0007 | The edit signal, joined to its creating run's cohort |

## 3. Components

### A. Holdout assignment (runtime) — DETERMINISTIC, per thread
`mintRun` sets `memory_holdout` computed, not literal `false`, using a **deterministic hash of the thread** (not a per-run coin flip):
- A module constant `MEMORY_HOLDOUT_RATE` (default `0.10`, overridable via env) — 0 disables the holdout entirely.
- `holdout = hashUnitInterval(threadId ?? runId) < MEMORY_HOLDOUT_RATE`, where `hashUnitInterval` maps a string to `[0,1)` via a stable hash (FNV-1a → `/ 2^32`). Bind the resulting bool as a param.
- **Why per-thread, not per-run:** a whole conversation is consistently memory-off or memory-on. This eliminates within-thread spillover — a per-run holdout run whose thread's EARLIER turns already put memory-informed assistant messages into context (`capToLastTurns`) is not a clean counterfactual — and it keeps a retried/re-requested turn on the SAME assignment (a per-run `Math.random()` re-rolls every request). Thread-less/autonomous runs hash their own `runId` (independently assigned). Deterministic ⇒ reproducible + auditable.
- `mintRun` returns `{ runId, holdout }` (the injection AND tool steps need it). Its one production caller (runtime.ts:232) updates; reflection mints inline and is unaffected.

### B. Suppression (runtime + `insertAttributions`)
The retrieval functions stay pure (they compute `injected` + `fenced`). The RUNTIME branches on `holdout`:
- **Treated run (holdout=false):** unchanged — inject the fence, log attributions with `suppressed=false`.
- **Holdout run (holdout=true):** log the SAME `injected` list as attributions with **`suppressed=true`**, and set the fence to `''` (inject nothing). The run proceeds memory-free; we've recorded exactly what memory *would* have contributed. Applies to BOTH the decisions/facts leg AND the rules leg — **both `memory.fenced` and `rules.fenced` are skipped**, so the combined injected fence is empty (`''`).
- **Also drop the `search_memory` tool on a holdout run.** Suppression must cover the TOOL path, not just injection — otherwise a holdout run could pull memory via `search_memory` (`via='tool'`) and contaminate the counterfactual. `buildTools` omits the memory-search tool when `holdout` is true, so a holdout run is genuinely memory-free (no injection, no tool).
- `insertAttributions` gains `ctx.suppressed?: boolean` (default false), bound into the existing insert (the `suppressed` column). The `ON CONFLICT (run_id, memory_id, injected_via) DO NOTHING` is unchanged.

Attribution-before-injection discipline is preserved: on a treated run we still attribute before injecting; on a holdout run there is no injection, only the suppressed record.

### C. The metric (domain)
`computeMemoryImpact(sql, tenantIds, windowDays = 30): Promise<MemoryImpact>` — org-scoped, over a window keyed on `proposals.decided_at`. Joins `proposals` → `agent_runs` on `run_id`, **restricted to `agent_runs.kind='chat'`** (the randomized runs — this EXCLUDES reflection-authored rule proposals, whose runs are always non-holdout and whose strength/pin edits would bias the treated cohort up), grouped by `memory_holdout`:
- Per cohort: `applied` = count(status='applied'), `edited` = count(status='applied' AND edited_payload IS NOT NULL), `editRate = edited/applied`; plus `rejected` = count(status='rejected') and `rejectRate = rejected/(applied+rejected)`.
- **Signed** delta: `delta = editRate_holdout − editRate_treated` (positive ⇒ memory helped). `savedEdits = round(delta × applied_treated)` — **NOT floored at 0**: a negative result is a real, honest finding that memory is hurting (surfaced as such, not hidden).
- **Confidence gate (the honest guard):** a closed-form **Newcombe (Wilson-score hybrid) two-proportion 95% CI** on `delta` (no library, ~15 lines) — chosen over the normal-approx Wald interval, which undercovers badly at small n with edit rates near 0 or 1 (exactly the small-sample/extreme-p regime this gate exists to protect against). `verdict`:
  - `insufficient` — either cohort below `MIN_SAMPLE` (default 20), OR the CI straddles 0 (indistinguishable from noise).
  - `helps` — CI lower bound > 0.
  - `hurts` — CI upper bound < 0.
- **Collider guard:** conditioning on `status='applied'` can bias if memory shifts the reject/edit mix. If cohort `rejectRate`s diverge materially (`|ΔrejectRate| > 0.10`), downgrade `verdict` to `insufficient` (the edit-rate comparison isn't clean) and surface the reject divergence instead.
- Shape: `{ window_days, holdout:{applied,edited,editRate,rejected,rejectRate}, treated:{…}, delta, savedEdits, ciLow, ciHigh, verdict }`.

The causal unit is the drafting chat run's holdout flag (memory present-or-not when the agent drew the proposal). NULL `run_id` proposals are excluded by the inner join (and apply.ts terminally fails run-less proposals anyway). Caveat (documented v1 limitation): proposals cluster within thread/run, so the proposal-level CI is mildly optimistic; a thread-clustered CI is a later refinement.

### D. Metric API route
`GET /api/agent/memory-impact?window=30` → `computeMemoryImpact` for the caller's org. Single-org anchored like the other agent routes (403/400/401 as they do).

### E. "Saved N edits" surface (web)
A card on the Memory board (its natural home — the memory system's value, next to the decision log). States driven by `verdict`, honest by construction:
- **`insufficient`** → *"Measuring how much memory helps — not enough data yet."* + the current cohort counts, small.
- **`helps`** → headline *"Memory saved you ~{savedEdits} edits in the last {window} days,"* with the auditable comparison beneath: *"You edited {holdout.editRate}% of the agent's proposals when it worked without memory (from {holdout.applied} proposals), vs {treated.editRate}% with it (from {treated.applied}) — measured from a {rate}% holdout."* The `~`, the visible cohort counts, and the CI keep the number non-inflated.
- **`hurts`** → the honest negative (never hidden as "no difference"): *"Right now you're editing MORE of the agent's proposals when memory is on ({treated.editRate}% vs {holdout.editRate}% without it). Your rules may be too broad — review them."* with a link to the rule list.

### F. "Rules active during this run" seam (deferred from P2a)
- Backend: expose, per proposal, the `kind='rule'` memories attributed to its run — `run_memory_attributions` JOIN `memories` filtered `kind='rule'`, scoped, keyed on the proposal's `run_id`. Add to the proposal detail payload (or a small dedicated endpoint).
- Web: feed the real rule titles into `RuleAttributionBadge` (today it receives `[]`), so a work-item proposal shows *"Rules active during this run: […]"* — worded active-during, not caused-by (unchanged wording).

## 4. Data flow

```
run mint ── FNV-1a(threadId ?? runId) < RATE ──► memory_holdout (per THREAD, deterministic)
                                          │
              treated (90%)               │              holdout (10%)
        retrieve → attribute(suppressed=false) → inject     retrieve → attribute(suppressed=true) → inject NOTHING
                                          │
         agent drafts proposal (memory-informed | memory-free)
                                          │  human reviews in the Inbox
                          proposal applied, edited_payload set iff they corrected it
                                          │
     computeMemoryImpact: group applied proposals by their run's memory_holdout
       editRate(holdout) − editRate(treated) → savedEdits (guarded by sample size)
                                          │
                         Memory board: honest "saved N edits" (or "measuring…")
```

## 5. Testing strategy
- **Holdout assignment:** deterministic — `hashUnitInterval` is stable (same input → same output); `RATE=1` → holdout true, `RATE=0` → false; the SAME `threadId` always yields the same assignment (retry stability); thread-less runs hash `runId`; `mintRun` returns `{runId, holdout}`.
- **Suppression:** a holdout run logs attributions with `suppressed=true`, injects an EMPTY combined fence (no `<org_memory>` AND no `<team_rules>` in the system prompt), AND omits the `search_memory` tool; a treated run is unchanged (`suppressed=false`, fences present, tool present). Both legs. `insertAttributions` binds `suppressed`.
- **Metric:** fixture proposals across cohorts → correct per-cohort editRate; **signed** `savedEdits = delta × treated volume` (a negative delta yields a negative savedEdits, NOT 0); `verdict='insufficient'` below MIN_SAMPLE and when the CI straddles 0; `verdict='helps'` only when ciLow>0; `verdict='hurts'` when ciHigh<0; **reflection/`kind<>'chat'` runs are excluded**; a material rejectRate divergence downgrades to `insufficient`.
- **Route:** org-scoped; returns the shape; empty/insufficient handled.
- **Surface (web):** all four verdict states render (measuring / helps-with-comparison-and-cohort-ns / hurts / insufficient); the headline number is shown ONLY on `helps`.
- **Attribution seam:** a proposal whose run injected a rule shows the rule title in the badge; no attributions → nothing rendered.

## 6. Deferred (YAGNI / later)
- **Auto-stop-once-proven** (turn the holdout off after significance) + **org-level holdout config** — v1 ships a config constant.
- **Thread-clustered CI** — v1's two-proportion CI treats proposals as independent (mildly optimistic given within-thread clustering); a clustered/bootstrap CI is a later refinement.
- **Per-memory value attribution** ("which decisions saved the most edits") — needs the suppressed-attribution join to outcomes; a later analytics pass.

## 7. Risks & mitigations
- **Small-sample noise → a misleading number.** The two-proportion 95% CI gate (headline only when it clears 0) + `MIN_SAMPLE` + the "measuring…" state + the visible cohort ns keep it honest; the CI, not a bare count, is the real guard.
- **Cohort contamination.** Reflection runs excluded (`kind='chat'`); the `search_memory` tool dropped on holdout runs; per-thread assignment prevents within-thread memory spillover — so "memory-off" is genuinely memory-off.
- **Collider bias** (conditioning on `applied`). A material rejectRate divergence downgrades the verdict to `insufficient` rather than reporting a biased edit-rate delta.
- **Holdout degrades ~10% of runs.** Bounded (human reviews every proposal; no silent bad output) and the rate is config (lower/zero once proven).
- **Selection validity.** Deterministic per-thread hashing keeps assignment stable + reproducible; the causal unit is the drafting chat run's holdout flag.
- **Very low-thread orgs may sit entirely in one cohort** (e.g. a tiny org with zero holdout threads) → `verdict='insufficient'` indefinitely. This is honest by construction — the surface says "measuring — not enough data yet," never a fabricated number. We deliberately do NOT revert to per-run to "fix" coverage (that reintroduces within-thread spillover); if low-volume coverage becomes a product concern, the lever is the deferred org-level rate config, not a change to the causal unit. (Note: because assignment is a fixed function of `RATE`, lowering `RATE` later can flip a near-boundary thread treated↔holdout on its next run — harmless, only on a config change.)

## 8. Defaults (change on request)
`MEMORY_HOLDOUT_RATE = 0.10` (env-overridable, 0 disables) · deterministic per-thread (FNV-1a) assignment · `MIN_SAMPLE = 20` applied proposals per cohort · Newcombe (Wilson-score) two-proportion 95% CI as the honest gate · `rejectRate` divergence threshold 0.10 · window default 30 days (on `decided_at`).
