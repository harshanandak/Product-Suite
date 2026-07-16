# Memory Brain P2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove — with a measured number, not a guess — that the memory brain reduces the human editing burden, via a deterministic per-thread ~10% holdout and an honest, CI-gated "saved N edits" surface. Plus the deferred "Rules active during this run" attribution seam.

**Architecture:** At run mint, a deterministic FNV-1a hash of the thread assigns ~10% of conversations to a memory holdout. A holdout run injects no memory (both fences skipped) and drops the `search_memory` tool, but still records what memory *would* have contributed (`run_memory_attributions.suppressed=true`). A domain metric groups applied chat-run proposals by their run's holdout flag and reports the edit-rate delta gated by a Newcombe two-proportion 95% CI.

**Tech Stack:** Hono + Cloudflare Workers (`platform-api`), Neon serverless Postgres via `sql.query(text, params)`, Vitest (api) + Vitest/Testing-Library (web), React + TanStack Router (`platform-web`).

**Spec:** `docs/design/2026-07-16-memory-brain-p2b.md` (read it first).

## Global Constraints

- **No new migration** — `agent_runs.memory_holdout` and `run_memory_attributions.suppressed` already exist (schema 0010). Do not add migrations or touch meta snapshots.
- **Neon HTTP, bound params only** (`sql.query(text, params)`); never string-interpolate values.
- **Holdout must be genuinely memory-free:** no injected fence (decisions/facts AND rules) AND no `search_memory` tool. But attribution is STILL written (`suppressed=true`) — the counterfactual record.
- **Attribution-before-injection discipline** and the two independent best-effort injection legs (each its own try/catch, own fence) from P2a must be preserved.
- **Deterministic per-thread assignment** — FNV-1a of `threadId ?? runId`; never `Math.random()`.
- **Honest metric:** signed delta (never floor a harm to 0); headline only when the Newcombe 95% CI clears 0; downgrade to `insufficient` on a material reject-rate divergence OR when either cohort has too few distinct applied threads (`MIN_THREADS` interim clustering guard); exclude non-`chat` runs (reflection).
- **Defaults:** `MEMORY_HOLDOUT_RATE=0.10` (env `MEMORY_HOLDOUT_RATE`), `MIN_SAMPLE=20`, window 30 days, reject-divergence 0.10.
- Commit per task, TDD. From `apps/platform-api` / `apps/platform-web` use `./node_modules/.bin/vitest run` + `./node_modules/.bin/tsc --noEmit` (never `npx`).

**Task order:** 1 (assignment) → 2 (suppression, needs mintRun's holdout) → 3 (metric) → 4 (route) → 5 (surface) → 6 (attribution seam, independent).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/platform-api/src/agent/holdout.ts` (create) | `hashUnitInterval` (FNV-1a) + `MEMORY_HOLDOUT_RATE` + `assignHoldout` | 1 |
| `apps/platform-api/src/agent/runtime.ts` (modify) | `mintRun` computes holdout + returns `{runId, holdout}`; caller; suppression branch | 1,2 |
| `apps/platform-api/src/agent/memory-retrieval.ts` (modify) | `insertAttributions` gains `suppressed` | 2 |
| `apps/platform-api/src/agent/tools.ts` (modify) | `buildTools` omits `search_memory` on holdout | 2 |
| `apps/platform-api/src/agent/memory-impact.ts` (create) | `computeMemoryImpact` + Newcombe CI + verdict | 3 |
| `apps/platform-api/src/routes/agent-memory-impact.ts` (create) | `GET /api/agent/memory-impact` | 4 |
| `apps/platform-api/src/app.ts` (modify) | mount the route | 4 |
| `apps/platform-web/src/boards/memory/MemoryImpactCard.tsx` (create) | the 4-state "saved N edits" card | 5 |
| `apps/platform-web/src/data/memory-impact/*` (create) | adapter + hook for the metric | 5 |
| `apps/platform-web/src/boards/memory/MemoryScreen.tsx` (modify) | mount the card | 5 |
| `apps/platform-api/src/routes/proposals.ts` (modify) | expose a proposal's run rule-attributions | 6 |
| `apps/platform-web/src/boards/inbox/ProposalDetail.tsx` (modify) | feed real titles to `RuleAttributionBadge` | 6 |

---

## Task 1: Deterministic per-thread holdout assignment

**Files:**
- Create: `apps/platform-api/src/agent/holdout.ts`
- Modify: `apps/platform-api/src/agent/runtime.ts` (`mintRun` + its caller at line 232)
- Test: `apps/platform-api/src/agent/holdout.test.ts`

**Interfaces produced:**
- `hashUnitInterval(key: string): number` — stable, in `[0,1)`.
- `MEMORY_HOLDOUT_RATE: number` — from `process.env.MEMORY_HOLDOUT_RATE` or 0.10.
- `assignHoldout(threadId: string | null, runId: string): boolean`.
- `mintRun` now returns `{ runId: string; holdout: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform-api/src/agent/holdout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hashUnitInterval, assignHoldout } from './holdout'

describe('hashUnitInterval', () => {
  it('is deterministic and in [0,1)', () => {
    const a = hashUnitInterval('thread_1')
    expect(a).toBe(hashUnitInterval('thread_1')) // stable
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    expect(hashUnitInterval('thread_1')).not.toBe(hashUnitInterval('thread_2'))
  })
})

describe('assignHoldout', () => {
  it('uses threadId when present, else runId; same thread → same assignment', () => {
    const t = assignHoldout('thread_x', 'run_a')
    expect(assignHoldout('thread_x', 'run_b')).toBe(t) // retry stability: thread wins
    // thread-less falls back to runId
    const r = assignHoldout(null, 'run_solo')
    expect(assignHoldout(null, 'run_solo')).toBe(r)
  })
})
```

- [ ] **Step 2: Run it → fails** (`./node_modules/.bin/vitest run src/agent/holdout.test.ts`) — module missing.

- [ ] **Step 3: Implement `holdout.ts`**

```ts
/** FNV-1a hash of a string → a stable value in [0,1). No RNG (deterministic + auditable). */
export function hashUnitInterval(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // >>> 0 → unsigned 32-bit; divide by 2^32 for [0,1).
  return (h >>> 0) / 0x100000000
}

/** Per-run holdout rate (fraction assigned memory-off). Env-overridable; 0 disables. */
export const MEMORY_HOLDOUT_RATE = (() => {
  const raw = Number(process.env.MEMORY_HOLDOUT_RATE)
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.1
})()

/**
 * Deterministic holdout assignment, keyed on the THREAD (so a whole conversation is
 * consistently memory-on or memory-off — no within-thread spillover, and a retried
 * turn keeps its assignment). Thread-less/autonomous runs key on their own runId.
 */
export function assignHoldout(threadId: string | null, runId: string): boolean {
  if (MEMORY_HOLDOUT_RATE <= 0) return false
  return hashUnitInterval(threadId ?? runId) < MEMORY_HOLDOUT_RATE
}
```

- [ ] **Step 4: Run it → passes.**

- [ ] **Step 5: Write the failing `mintRun` test**

In `apps/platform-api/src/agent/runtime.test.ts` (mirror the existing mint test), assert `mintRun` inserts a computed `memory_holdout` (bound param) and returns `{ runId, holdout }`. With `MEMORY_HOLDOUT_RATE` forced (e.g. mock the module const or set env before import) to 1 → holdout true bound; the return object has both fields.

- [ ] **Step 6: Run it → fails.**

- [ ] **Step 7: Update `mintRun` + caller in `runtime.ts`**

`mintRun` computes holdout and binds it (replacing the literal `false`), returning both:

```ts
async function mintRun(
  sql: Sql,
  tenantId: string,
  userId: string,
  threadId?: string,
): Promise<{ runId: string; holdout: boolean }> {
  const id = crypto.randomUUID()
  const holdout = assignHoldout(threadId ?? null, id)
  const rows = await runQuery<{ id: string }>(
    sql,
    `insert into "agent_runs" ("id", "tenant_id", "triggered_by", "kind", "status", "thread_id", "memory_holdout")
     values ($1, $2, $3, 'chat', 'running', $4, $5) returning id`,
    [id, tenantId, userId, threadId ?? null, holdout],
  )
  if (!rows[0]?.id) throw new Error('mintRun: insert returned no id')
  return { runId: rows[0].id, holdout }
}
```

(Generate the id client-side so `assignHoldout` can key on it for thread-less runs; add `import { assignHoldout } from './holdout'`.)

Update the caller (line 232):

```ts
  const { runId, holdout } = await mintRun(sql, ctx.tenantId, ctx.userId, ctx.threadId)
```

- [ ] **Step 8: Run runtime tests + full api suite + typecheck → green.** (Existing mint test asserting bound params `[tenant_id, triggered_by, thread_id]` must be updated to the new param list.)

- [ ] **Step 9: Commit** — `feat(agent): deterministic per-thread memory holdout assignment`.

---

## Task 2: Suppression — memory-free holdout runs

**Files:**
- Modify: `apps/platform-api/src/agent/memory-retrieval.ts` (`insertAttributions` + `suppressed`)
- Modify: `apps/platform-api/src/agent/tools.ts` (`buildTools` drops `search_memory` on holdout)
- Modify: `apps/platform-api/src/agent/runtime.ts` (both injection legs branch on `holdout`)
- Test: `memory-retrieval.test.ts`, `tools.test.ts`, `runtime.test.ts`

**Interfaces:**
- Consumes: `holdout` from Task 1.
- Produces: `insertAttributions` `ctx` gains `suppressed?: boolean` (default false); `buildTools` ctx gains `holdout?: boolean`.

- [ ] **Step 1: Failing test — `insertAttributions` binds `suppressed`**

In `memory-retrieval.test.ts`: calling `insertAttributions(sql, {runId, tenantId, via:'retrieved', suppressed:true}, entries)` inserts rows whose `suppressed` param is `true`; default (omitted) → `false`. Assert the query text includes `"suppressed"` and the bound value.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Extend `insertAttributions`**

`ctx` type gains `suppressed?: boolean`. Add `"suppressed"` to the insert columns and bind `ctx.suppressed ?? false` per row:

```ts
export async function insertAttributions(
  sql: Sql,
  ctx: { runId: string; tenantId: string; via: 'pinned' | 'retrieved' | 'tool'; suppressed?: boolean },
  entries: { memoryId: string; rank: number | null; tokens: number | null; via?: 'pinned' | 'retrieved' | 'tool' }[],
): Promise<void> {
  if (entries.length === 0) return
  const params: unknown[] = []
  const tuples: string[] = []
  for (const e of entries) {
    const base = params.length
    params.push(ctx.runId, e.memoryId, ctx.tenantId, e.via ?? ctx.via, e.rank ?? null, e.tokens ?? null, ctx.suppressed ?? false)
    tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`)
  }
  const text = `
    insert into "run_memory_attributions"
      ("run_id", "memory_id", "tenant_id", "injected_via", "rank", "tokens", "suppressed")
    values ${tuples.join(', ')}
    on conflict ("run_id", "memory_id", "injected_via") do nothing
  `
  await runQuery(sql, text, params)
}
```

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Failing test — `buildTools` omits `search_memory` on holdout**

In `tools.test.ts`: `buildTools(sql, {..., holdout:true})` returns a ToolSet WITHOUT `search_memory`; `holdout:false`/omitted keeps it.

- [ ] **Step 6: Run → fails.**

- [ ] **Step 7: `buildTools` drops the memory tool on holdout**

`ToolContext` gains `holdout?: boolean`. Build the full set, then omit the memory-search tool when holdout (so a holdout run cannot pull memory via the tool):

```ts
  const toolset = { /* …all tools including search_memory… */ } satisfies ToolSet
  if (ctx.holdout) {
    const { search_memory: _omit, ...rest } = toolset
    return rest
  }
  return toolset
```

(Adjust to the file's actual return shape; the invariant: no `search_memory` key when `ctx.holdout`.)

- [ ] **Step 8: Wire `holdout` into `buildTools` + the injection legs (runtime.ts)**

Pass holdout to buildTools:
```ts
  const tools = buildTools(sql, { tenantId: ctx.tenantId, userId: ctx.userId, runId, modelId, holdout })
```
Leg 1 (decisions/facts) — attribute with `suppressed: holdout`, fence only when NOT holdout:
```ts
    if (memory.injected.length > 0) {
      await insertAttributions(
        sql,
        { runId, tenantId: ctx.tenantId, via: 'retrieved', suppressed: holdout },
        memory.injected.map((m) => ({ memoryId: m.memoryId, rank: m.rank, tokens: m.tokens })),
      )
    }
    memoryFence = holdout ? '' : memory.fenced
```
Leg 2 (rules) — same:
```ts
      await insertAttributions(
        sql,
        { runId, tenantId: ctx.tenantId, via: 'retrieved', suppressed: holdout },
        rules.injected.map((m) => ({ memoryId: m.memoryId, rank: m.rank, tokens: m.tokens, via: m.via })),
      )
    }
    if (!holdout) memoryFence += rules.fenced
```

- [ ] **Step 9: Failing runtime test — a holdout run is memory-free**

Assert: on a holdout run (force assignment), the composed `system` prompt contains NEITHER `<org_memory` NOR `<team_rules`; the attribution inserts bind `suppressed=true`; and the toolset passed to `streamText` has no `search_memory`. A treated run is unchanged (fences present, `suppressed=false`, tool present).

- [ ] **Step 10: Run runtime + full api suite + typecheck → green.**

- [ ] **Step 11: Commit** — `feat(agent): suppress memory on holdout runs (no fence, no tool, log counterfactual)`.

---

## Task 3: The metric — `computeMemoryImpact` + Newcombe CI

**Files:**
- Create: `apps/platform-api/src/agent/memory-impact.ts`
- Test: `apps/platform-api/src/agent/memory-impact.test.ts`

**Interfaces produced:**
- `newcombeDiffCI(x1,n1,x2,n2): { lower: number; upper: number }` — 95% CI for `p1−p2`.
- `computeMemoryImpact(sql, tenantIds: string[], windowDays?: number): Promise<MemoryImpact>`.
- `MemoryImpact` = `{ window_days, holdout: Cohort, treated: Cohort, delta, savedEdits, ciLow, ciHigh, verdict }`, `Cohort = { applied, edited, editRate, rejected, rejectRate, threads }`, `verdict: 'helps'|'hurts'|'insufficient'`.

> **CI is proposal-level (an approximation).** The Newcombe two-proportion CI treats proposals as INDEPENDENT, but holdout assignment and within-thread correlation are per-THREAD, so with many proposals in few threads the CI is anti-conservative. The interim conservatism is a `MIN_THREADS` (default 5) gate in `decideVerdict`: if either cohort has fewer than 5 distinct applied threads (the query adds `count(distinct thread_id) filter (where status='applied') as threads` per cohort), return `insufficient` regardless of proposal counts. A thread-clustered/bootstrap CI is the tracked refinement (§6 deferred) that will replace this gate; `MIN_THREADS` is an honest interim, never a loosening of the existing MIN_SAMPLE / reject-divergence / CI-vs-0 gates.

- [ ] **Step 1: Failing test — the Newcombe CI + verdict logic (pure, no DB)**

```ts
import { describe, expect, it } from 'vitest'
import { newcombeDiffCI, decideVerdict } from './memory-impact'

describe('newcombeDiffCI', () => {
  it('brackets the point difference and is symmetric-ish', () => {
    const ci = newcombeDiffCI(15, 30, 5, 30) // p1=.5, p2=.167, diff≈.333
    expect(ci.lower).toBeLessThan(0.333)
    expect(ci.upper).toBeGreaterThan(0.333)
    expect(ci.lower).toBeGreaterThan(0) // a strong positive separates from 0
  })
  it('a tiny sample does NOT separate from 0', () => {
    const ci = newcombeDiffCI(3, 4, 1, 4)
    expect(ci.lower).toBeLessThanOrEqual(0) // CI straddles 0 → insufficient
  })
})

describe('decideVerdict', () => {
  const base = { holdout: { applied: 40, rejected: 5, rejectRate: 0.11 }, treated: { applied: 200, rejected: 24, rejectRate: 0.11 } }
  it('helps when ciLow>0 and samples sufficient and reject rates close', () => {
    expect(decideVerdict({ ...base, ciLow: 0.05, ciHigh: 0.2 })).toBe('helps')
  })
  it('hurts when ciHigh<0', () => {
    expect(decideVerdict({ ...base, ciLow: -0.2, ciHigh: -0.03 })).toBe('hurts')
  })
  it('insufficient when the CI straddles 0', () => {
    expect(decideVerdict({ ...base, ciLow: -0.05, ciHigh: 0.08 })).toBe('insufficient')
  })
  it('insufficient below MIN_SAMPLE', () => {
    expect(decideVerdict({ holdout: { applied: 5, rejected: 0, rejectRate: 0 }, treated: { applied: 200, rejected: 10, rejectRate: 0.05 }, ciLow: 0.1, ciHigh: 0.3 })).toBe('insufficient')
  })
  it('insufficient when reject rates diverge materially (collider guard)', () => {
    expect(decideVerdict({ holdout: { applied: 40, rejected: 20, rejectRate: 0.33 }, treated: { applied: 200, rejected: 10, rejectRate: 0.05 }, ciLow: 0.1, ciHigh: 0.3 })).toBe('insufficient')
  })
})
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement the pure stats**

```ts
export const MIN_SAMPLE = 20
export const REJECT_DIVERGENCE = 0.1
const Z = 1.959963984540054 // 95%

/** Wilson score interval for a single proportion. */
function wilson(x: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 }
  const p = x / n
  const z2 = Z * Z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { lo: center - half, hi: center + half }
}

/** Newcombe (method 10) 95% CI for p1 − p2 from Wilson single-proportion intervals. */
export function newcombeDiffCI(x1: number, n1: number, x2: number, n2: number): { lower: number; upper: number } {
  const p1 = n1 ? x1 / n1 : 0
  const p2 = n2 ? x2 / n2 : 0
  const w1 = wilson(x1, n1)
  const w2 = wilson(x2, n2)
  const d = p1 - p2
  const lower = d - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2)
  const upper = d + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2)
  return { lower, upper }
}

interface VerdictInput {
  holdout: { applied: number; rejected: number; rejectRate: number }
  treated: { applied: number; rejected: number; rejectRate: number }
  ciLow: number
  ciHigh: number
}
export function decideVerdict(v: VerdictInput): 'helps' | 'hurts' | 'insufficient' {
  if (v.holdout.applied < MIN_SAMPLE || v.treated.applied < MIN_SAMPLE) return 'insufficient'
  if (Math.abs(v.holdout.rejectRate - v.treated.rejectRate) > REJECT_DIVERGENCE) return 'insufficient'
  if (v.ciLow > 0) return 'helps'   // holdout edits MORE than treated ⇒ memory helped
  if (v.ciHigh < 0) return 'hurts'
  return 'insufficient'
}
```

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Failing test — `computeMemoryImpact` query + assembly (mocked sql)**

Mock `sql.query` to return per-cohort aggregate rows; assert the query joins `proposals`→`agent_runs`, filters `kind='chat'` + the window on `decided_at` + tenant scope, groups by `memory_holdout`; and that the assembled result has correct editRate/rejectRate, `delta = editRate_holdout − editRate_treated`, `savedEdits = round(delta × treated.applied)` (SIGNED — a negative delta yields negative savedEdits), and `verdict` from `decideVerdict`.

- [ ] **Step 6: Run → fails.**

- [ ] **Step 7: Implement `computeMemoryImpact`**

```ts
import type { Sql } from '@product-suite/db'

export interface Cohort { applied: number; edited: number; editRate: number; rejected: number; rejectRate: number }
export interface MemoryImpact {
  window_days: number
  holdout: Cohort
  treated: Cohort
  delta: number
  savedEdits: number
  ciLow: number
  ciHigh: number
  verdict: 'helps' | 'hurts' | 'insufficient'
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

function cohort(applied: number, edited: number, rejected: number): Cohort {
  return {
    applied, edited, rejected,
    editRate: applied ? edited / applied : 0,
    rejectRate: applied + rejected ? rejected / (applied + rejected) : 0,
  }
}

export async function computeMemoryImpact(sql: Sql, tenantIds: string[], windowDays = 30): Promise<MemoryImpact> {
  // One grouped aggregate: applied + edited + rejected per holdout cohort, chat runs only.
  const rows = await runQuery<{ memory_holdout: boolean; applied: number; edited: number; rejected: number }>(
    sql,
    `select r."memory_holdout",
        count(*) filter (where p.status = 'applied')::int as applied,
        count(*) filter (where p.status = 'applied' and p.edited_payload is not null)::int as edited,
        count(*) filter (where p.status = 'rejected')::int as rejected
     from "proposals" p
     join "agent_runs" r on r.id = p.run_id
     where p.tenant_id = any($1) and r.kind = 'chat'
       and p.decided_at >= now() - ($2 || ' days')::interval
     group by r."memory_holdout"`,
    [tenantIds, String(windowDays)],
  )
  const h = rows.find((x) => x.memory_holdout) ?? { applied: 0, edited: 0, rejected: 0 }
  const t = rows.find((x) => !x.memory_holdout) ?? { applied: 0, edited: 0, rejected: 0 }
  const holdout = cohort(h.applied, h.edited, h.rejected)
  const treated = cohort(t.applied, t.edited, t.rejected)
  const delta = holdout.editRate - treated.editRate
  const { lower: ciLow, upper: ciHigh } = newcombeDiffCI(holdout.edited, holdout.applied, treated.edited, treated.applied)
  const verdict = decideVerdict({ holdout, treated, ciLow, ciHigh })
  return { window_days: windowDays, holdout, treated, delta, savedEdits: Math.round(delta * treated.applied), ciLow, ciHigh, verdict }
}
```

- [ ] **Step 8: Run tests + typecheck → green.**

- [ ] **Step 9: Commit** — `feat(agent): memory-impact metric — edit-rate delta + Newcombe CI verdict`.

---

## Task 4: Metric API route

**Files:**
- Create: `apps/platform-api/src/routes/agent-memory-impact.ts`
- Modify: `apps/platform-api/src/app.ts` (mount it)
- Test: `apps/platform-api/src/routes/agent-memory-impact.test.ts`

**Interfaces:** `GET /api/agent/memory-impact?window=30` → `MemoryImpact` JSON, single-org anchored.

- [ ] **Step 1: Failing route test** — mirror `agent-reflection.test.ts`: 200 + the shape for a valid single-org caller; 401 no token; 403/400 no-org/ambiguous (follow the existing agent-route auth helpers `callerTenantIds`/single-org anchor pattern in that file). `window` parsed (default 30, clamped to a sane max e.g. 365).

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement the route** — a Hono handler that resolves the caller's single org (reuse the exact pattern from `agent-reflection.ts`), reads `window` (int, default 30, clamp 1..365), calls `computeMemoryImpact(sql, [tenantId], window)`, returns `c.json(result)`. Mount in `app.ts` under `/api/agent` alongside the reflection route.

- [ ] **Step 4: Run + full api suite + typecheck → green.**

- [ ] **Step 5: Commit** — `feat(api): GET /api/agent/memory-impact`.

---

## Task 5: "Saved N edits" surface (web)

**Files:**
- Create: `apps/platform-web/src/data/memory-impact/adapter.ts`, `use-memory-impact.ts`, `types.ts`
- Create: `apps/platform-web/src/boards/memory/MemoryImpactCard.tsx`
- Modify: `apps/platform-web/src/boards/memory/MemoryScreen.tsx` (mount the card)
- Test: `apps/platform-web/src/boards/memory/MemoryImpactCard.test.tsx`

**Interfaces:** the adapter fetches `GET /api/agent/memory-impact` → `MemoryImpact`; the hook exposes `{ impact, loading, error }`. The card renders per `verdict`.

- [ ] **Step 1: Failing test — the four verdict states**

In `MemoryImpactCard.test.tsx` (stub the hook with a fixture `MemoryImpact`):
- `verdict:'insufficient'` → renders "not enough data" / "Measuring", and NO headline number.
- `verdict:'helps'` with `savedEdits:12` → renders "saved you ~12 edits" AND the comparison line with both cohort editRates + both `applied` counts.
- `verdict:'hurts'` → renders the "editing MORE … with memory" copy and NO positive "saved" number.
- Never shows a headline number unless `verdict:'helps'`.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Build the data layer + card**

- `types.ts` mirrors `MemoryImpact`/`Cohort`.
- `adapter.ts`: `getMemoryImpact(window=30)` → GET the endpoint (follow the existing `data/memories/adapter.ts` fetch/error pattern).
- `use-memory-impact.ts`: a hook returning `{ impact, loading, error }` (mirror `use-memories.ts`).
- `MemoryImpactCard.tsx`: a shadcn card. Branch on `impact.verdict`:
  - `insufficient` → muted "Measuring how much memory helps — not enough data yet." + small counts (`{holdout.applied} / {treated.applied}` proposals).
  - `helps` → headline "Memory saved you ~{savedEdits} edits in the last {window_days} days" + comparison: "You edited {holdout.editRate as %} of the agent's proposals without memory (from {holdout.applied}), vs {treated.editRate as %} with it (from {treated.applied})." Format rates as whole-percent.
  - `hurts` → caution-styled: "You're editing more of the agent's proposals with memory on ({treated.editRate%} vs {holdout.editRate%}). Your rules may be too broad — review them." + a link to the rule list.
  Follow the platform-web design system; reuse the amber caution treatment used by the P2a `RuleProposalSurface`/`ProposalCard`.
- Mount `<MemoryImpactCard/>` at the top of `MemoryScreen.tsx`.

- [ ] **Step 4: Run focused test + full web suite + typecheck → green.**

- [ ] **Step 5: Commit** — `feat(memory): "saved N edits" impact card (honest, CI-gated states)`.

---

## Task 6: "Rules active during this run" attribution seam

**Files:**
- Modify: `apps/platform-api/src/routes/proposals.ts` (expose a proposal's run rule-attributions)
- Modify: `apps/platform-web/src/boards/inbox/ProposalDetail.tsx` (feed real titles to `RuleAttributionBadge`)
- Test: api route test + `ProposalDetail.test.tsx`

**Interfaces:** for a proposal, return the `kind='rule'` memory titles attributed (non-suppressed) to its `run_id`.

- [ ] **Step 1: Failing api test** — a new read (either a field on the proposal detail response or `GET /api/proposals/:id/active-rules`): returns the titles of `kind='rule'` memories in `run_memory_attributions` for the proposal's `run_id`, tenant-scoped, `suppressed=false`. Empty when none.

Query shape:
```sql
select m.id, m.title
from run_memory_attributions a
join memories m on m.id = a.memory_id
where a.run_id = $1 and a.tenant_id = $2 and a.suppressed = false and m.kind = 'rule'
order by a.rank asc
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** the scoped query + expose it (a small `GET /api/proposals/:id/active-rules` mirrors the accept/reject handlers' scoping in `proposals.ts`). Return `{ rules: { id, title }[] }`.

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Web — feed the badge**

In `ProposalDetail.tsx`, for a work-item proposal, fetch its active-rules (a small effect, like the memory-target fetch already there) and pass the titles into `RuleAttributionBadge ruleTitles={titles}` (today hardcoded `[]`). Add a test: a proposal with an active rule renders "Rules active during this run: {title}"; none → the badge renders nothing.

- [ ] **Step 6: Run focused + full web suite + typecheck → green.**

- [ ] **Step 7: Commit** — `feat(inbox): surface rules active during a proposal's run`.

---

## Self-Review

**Spec coverage:** §A holdout assignment → Task 1 ✓ · §B suppression (fence + tool + suppressed attribution) → Task 2 ✓ · §C metric (kind='chat', signed delta, Newcombe CI, collider guard, decided_at) → Task 3 ✓ · §D route → Task 4 ✓ · §E four-state surface → Task 5 ✓ · §F attribution seam → Task 6 ✓. No migration (correct — rails exist).

**Deferred (correctly absent):** auto-stop-once-proven, org-level rate config, thread-clustered CI, per-memory value attribution.

**Type consistency:** `MemoryImpact`/`Cohort`/`verdict` identical across Tasks 3→4→5; `insertAttributions` `suppressed?` + per-row `via?` consistent with the P2a signature; `mintRun` `{runId, holdout}` consumed in Task 2's caller edit.

**Verify at build time:** confirm the `agent-reflection.ts` single-org auth pattern for Tasks 4/6; confirm `run_memory_attributions` has a `suppressed` column (schema 0010) and `proposals.decided_at` exists; the existing mint test's bound-param assertion needs updating (Task 1 Step 8).
