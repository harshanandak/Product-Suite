# Memory Brain P2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the memory-brain *self-learning mechanism*: an agent that learns **rules** from recurring human corrections of its proposals, proposes them through the existing Review Inbox, and injects accepted rules into future runs.

**Architecture:** A headless **reflection job** mines accepted+edited work-item proposals, clusters by edited-field-set, and — for patterns recurring ≥N — emits `kind='rule'` memory proposals (via `createProposal`, under a self-minted `agent_run`) carrying structural evidence. Accepted rules persist `attrs.applies_when` + per-rule `enforcement`/`pinned`, then inject as the full active in-scope set under a distinct "Team rules" fence. Holdout/measurement is P2b.

**Tech Stack:** Hono + Cloudflare Workers (`platform-api`), Neon serverless Postgres via `sql.query(text, params)`, Drizzle schema (hand-authored migrations), Vitest (api) + Vitest/Testing-Library (web), React + TanStack Router (`platform-web`), zod.

**Spec:** `docs/design/2026-07-16-memory-brain-p2a.md` (read it first — this plan implements it).

## Global Constraints

- **Neon HTTP, no interactive transactions.** Every DB write is `sql.query(text, params)` with bound params; multi-statement atomicity uses a single CTE (see `supersedeMemory`). Never string-interpolate values.
- **Tenant isolation is a security boundary.** Every query filters `tenant_id`; a foreign id must be indistinguishable from unknown (`not_found`), never a cross-tenant leak.
- **Migrations are hand-authored** SQL + a `_journal.json` entry (drizzle-kit does not resolve in the worktree). Additive only. Do **not** touch the meta snapshots (pre-existing drift, tracked separately).
- **Injected memory is fenced untrusted data**, appended AFTER the base prompt, never trusted as instructions (P1 mechanism — reuse `fenceMemories`/`sanitizeForFence`).
- **Reflection origin sentinel:** a reflection `agent_run` sets `triggered_by = 'reflection'` (a reserved sentinel — the column is documented `users.id` but is `text`; do NOT resolve it to a user).
- **`edited_payload` is a wholesale replace** (`apply.ts` does `edited_payload ?? payload`), then re-validated where `kind`+`title` are required — so any `edited_payload` written at accept MUST be the full merged payload, never a partial.
- **Commit per task**, TDD (failing test first). Run the api suite from `apps/platform-api` and web from `apps/platform-web` with `./node_modules/.bin/vitest run` and `./node_modules/.bin/tsc --noEmit`.
- **N (recurrence threshold) = 2**, window = 30 days, defaults live as named consts.

**Task order is load-bearing:** Task 1 (migration) → Task 2 (write-path) → Task 3 (reflection) → Task 4 (injection) → Task 5 (UI). Reflection proposals are unusable until the write-path (Task 2) can persist rule fields.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/db/migrations/0012_proposals_reflected_at.sql` (create) | Additive `proposals.reflected_at` column | 1 |
| `packages/db/migrations/meta/_journal.json` (modify) | Journal entry for 0012 | 1 |
| `packages/db/src/schema.ts` (modify) | `proposals.reflectedAt` column | 1 |
| `apps/platform-api/src/domain/memories.ts` (modify) | `createMemory` writes `enforcement`/`pinned`; `CreateMemoryInput` gains them | 2 |
| `apps/platform-api/src/proposals/apply.ts` (modify) | `memoryCreatePayload`/`memorySupersedePayload` accept `attrs`/`enforcement`/`pinned`; dispatch passes them | 2 |
| `apps/platform-api/src/agent/reflection.ts` (create) | The reflection engine: diff → cluster → gate → propose; mints its own run | 3 |
| `apps/platform-api/src/agent/reflection.test.ts` (create) | Reflection unit tests (LLM mocked) | 3 |
| `apps/platform-api/src/routes/agent.ts` (modify, or new `reflection` route) | `POST /api/agent/reflection/run` | 3 |
| `apps/platform-api/src/agent/memory-retrieval.ts` (modify) | `retrieveRulesForContext` (own select incl. `attrs`, ordering, sub-budget) + `fenceRules` | 4 |
| `apps/platform-api/src/agent/runtime.ts` (modify) | Call rules retrieval, append the Team-rules fence, attribute (`pinned`/`retrieved`) | 4 |
| `apps/platform-web/src/boards/inbox/RuleProposalSurface.tsx` (create) | Rule proposal view: applies-when + evidence "changed N×" + strength controls | 5 |
| `apps/platform-web/src/boards/inbox/ProposalDetail.tsx` (modify) | Branch to `RuleProposalSurface`; accept merges toggles into full `edited_payload`; "Rules active during this run" | 5 |
| `apps/platform-web/src/boards/inbox/RuleAttributionBadge.tsx` (create) | "Rules active during this run: […]" | 5 |
| `apps/platform-api/src/routes/memories.ts` (verify) | `POST /api/memories/:id/retract` already exists (revoke) — no change unless recording `change_reason` | 5 |

---

## Task 1: Migration — `proposals.reflected_at`

**Files:**
- Create: `packages/db/migrations/0012_proposals_reflected_at.sql`
- Modify: `packages/db/migrations/meta/_journal.json` (append entry)
- Modify: `packages/db/src/schema.ts` (proposals table, ~line 399)
- Test: none (schema-only; verified by the api suite typecheck + Task 3 tests that read the column)

**Interfaces:**
- Produces: `proposals.reflected_at timestamptz NULL` — the idempotency marker Task 3 filters on (`reflected_at IS NULL`) and stamps.

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/migrations/0012_proposals_reflected_at.sql`:

```sql
-- Memory Brain P2a — idempotency marker for the reflection engine. A correction
-- (an accepted proposal with edited_payload) is mined into at most one rule proposal;
-- reflected_at is stamped ONLY when the correction is folded into an emitted rule
-- proposal, so a sub-threshold pattern stays NULL and can mature on a later run.
-- Additive + nullable; hand-authored (drizzle-kit generate unavailable in the worktree).
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "reflected_at" timestamptz;
```

- [ ] **Step 2: Append the journal entry**

In `packages/db/migrations/meta/_journal.json`, append to `entries` (after the `0011` entry, incrementing `idx`; use a `when` one day after 0011's — `1784563200000`):

```json
    {
      "idx": 12,
      "version": "7",
      "when": 1784563200000,
      "tag": "0012_proposals_reflected_at",
      "breakpoints": true
    }
```

- [ ] **Step 3: Add the Drizzle column**

In `packages/db/src/schema.ts`, inside the `proposals` pgTable definition (near the other nullable columns like `editedPayload`), add:

```ts
    // Memory Brain P2a: stamped when this correction (an accepted proposal with an
    // edited_payload) is folded into an emitted rule proposal by the reflection engine,
    // so it is never mined twice. NULL = not yet reflected (or not a correction).
    reflectedAt: timestamp('reflected_at', { withTimezone: true }),
```

- [ ] **Step 4: Verify typecheck**

Run: `cd apps/platform-api && ./node_modules/.bin/tsc --noEmit`
Expected: exit 0 (the new column is referenced by Task 3; here it must at least compile in `packages/db`).
Also run: `cd packages/db && ./node_modules/.bin/tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0012_proposals_reflected_at.sql packages/db/migrations/meta/_journal.json packages/db/src/schema.ts
git commit -m "feat(db): proposals.reflected_at — reflection idempotency marker (0012)"
```

---

## Task 2: Write-path — persist `attrs`/`enforcement`/`pinned` on a rule

The apply path currently zod-strips these, and `createMemory` never writes `enforcement`/`pinned`. Without this, an accepted rule can carry no applicability and no strength — the feature's core.

**Files:**
- Modify: `apps/platform-api/src/domain/memories.ts` (`CreateMemoryInput`, `createMemory` insert)
- Modify: `apps/platform-api/src/proposals/apply.ts` (`memoryCreatePayload`, `memorySupersedePayload`, `applyMemoryCommand` dispatch)
- Test: `apps/platform-api/src/domain/memories.test.ts`, `apps/platform-api/src/proposals/apply.test.ts`

**Interfaces:**
- Consumes: `createMemory` from Task-0 baseline.
- Produces: `CreateMemoryInput` gains `attrs?: unknown`, `enforcement?: 'advisory' | 'hard'`, `pinned?: boolean`; `createMemory` writes all three. `memoryCreatePayload`/`memorySupersedePayload` accept them; `applyMemoryCommand` forwards them.

- [ ] **Step 1: Write the failing domain test**

In `apps/platform-api/src/domain/memories.test.ts`, add to the `createMemory` describe block:

```ts
it('writes enforcement + pinned + attrs when creating a rule', async () => {
  const RULE = { ...ROW, kind: 'rule' as const, enforcement: 'hard' as const, pinned: true }
  const { sql, query } = mockSql(() => [RULE])
  await createMemory(
    sql,
    { tenantId: 't_1', actor: 'u_1' },
    {
      kind: 'rule',
      title: 'Prefer concise titles',
      attrs: { applies_when: 'work items in project Foo', evidence_proposal_ids: ['p_1', 'p_2'] },
      enforcement: 'hard',
      pinned: true,
    },
  )
  const [text, params] = query.mock.calls[0]!
  expect(String(text)).toMatch(/"enforcement"/)
  expect(String(text)).toMatch(/"pinned"/)
  // attrs jsonb carries applies_when + evidence
  const attrsParam = params.find((p: unknown) => typeof p === 'string' && String(p).includes('applies_when'))
  expect(attrsParam).toBeTruthy()
  expect(params).toContain('hard')
  expect(params).toContain(true)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/domain/memories.test.ts -t "writes enforcement"`
Expected: FAIL — the insert text has no `"enforcement"`/`"pinned"` columns.

- [ ] **Step 3: Extend `CreateMemoryInput` and the `createMemory` insert**

In `apps/platform-api/src/domain/memories.ts`, add to `CreateMemoryInput` (after `decidedBy?`):

```ts
  /** Rule-only (P2a): enforcement strength + pin. Default advisory / unpinned. */
  enforcement?: 'advisory' | 'hard'
  pinned?: boolean
```

Then change the `createMemory` insert to include the two columns. Update the column list, the values tuple, and the params array:

```ts
  const text = `
    insert into "memories" (
      "id", "tenant_id", "kind", "title", "body", "attrs", "root_id",
      "status", "scope_type", "scope_id", "topics", "source_kind",
      "source_run_id", "source_proposal_id", "source_quote", "created_by", "decided_by",
      "enforcement", "pinned"
    ) values (
      $1, $2, $3, $4, $5, $6::jsonb, $1,
      'active', $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17
    ) returning ${RETURNING}
  `
  const params = [
    id,
    ctx.tenantId,
    input.kind,
    title,
    input.body ?? '',
    input.attrs === undefined ? null : JSON.stringify(input.attrs),
    scopeType,
    scopeId,
    input.topics ?? [],
    input.sourceKind ?? 'manual',
    input.sourceRunId ?? null,
    input.sourceProposalId ?? null,
    input.sourceQuote ?? null,
    ctx.actor,
    input.decidedBy ?? null,
    input.enforcement ?? 'advisory',
    input.pinned ?? false,
  ]
```

- [ ] **Step 4: Run the domain test to verify it passes**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/domain/memories.test.ts -t "writes enforcement"`
Expected: PASS.

- [ ] **Step 5: Write the failing apply test**

In `apps/platform-api/src/proposals/apply.test.ts`, add a test that a rule create proposal carrying the three fields forwards them to `createMemory` (mirror the existing memory-create apply test; assert the create input):

```ts
it('applies a rule create proposal with attrs + enforcement + pinned', async () => {
  const claimed = {
    ...PROPOSAL, // an applied-claim fixture with target_type='memory', operation='create'
    target_type: 'memory',
    operation: 'create',
    run_id: 'run_1',
    payload: {
      kind: 'rule',
      title: 'Prefer concise titles',
      attrs: { applies_when: 'project Foo', evidence_proposal_ids: ['p_1', 'p_2'] },
      enforcement: 'hard',
      pinned: true,
    },
    edited_payload: null,
  }
  const { sql, query } = mockSql(applyRouter(claimed)) // existing helper pattern
  await applyProposal(sql, { tenantIds: ['t_1'], approverUserId: 'u_1' }, claimed.id)
  const insert = query.mock.calls.find(([t]) => /insert into "memories"/i.test(String(t)))!
  expect(insert[1]).toContain('hard')
  expect(insert[1]).toContain(true)
  const attrsParam = insert[1].find((p: unknown) => typeof p === 'string' && String(p).includes('applies_when'))
  expect(attrsParam).toBeTruthy()
})
```

(If the existing apply-memory test uses a different fixture/helper shape, follow that shape — the assertion is what matters: the create insert receives `hard`, `true`, and an `attrs` jsonb with `applies_when`.)

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/proposals/apply.test.ts -t "rule create proposal with attrs"`
Expected: FAIL — zod strips the fields, so `hard`/`true`/`attrs` never reach the insert.

- [ ] **Step 7: Extend the apply payload schemas + dispatch**

In `apps/platform-api/src/proposals/apply.ts`, extend the two schemas:

```ts
const memoryCreatePayload = z.object({
  kind: z.enum(['decision', 'fact', 'rule']),
  title: z.string(),
  body: z.string().optional(),
  topics: z.array(z.string()).optional(),
  scope_type: z.enum(['org', 'project', 'work_item_type', 'work_item']).optional(),
  scope_id: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  enforcement: z.enum(['advisory', 'hard']).optional(),
  pinned: z.boolean().optional(),
})
const memorySupersedePayload = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  topics: z.array(z.string()).optional(),
  change_reason: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
})
```

In `applyMemoryCommand`, the `create` branch, pass the new fields to `createMemory`:

```ts
    const p = parseMemoryPayload(memoryCreatePayload, payload)
    return createMemory(
      sql,
      { tenantId, actor: runId },
      {
        kind: p.kind,
        title: p.title,
        body: p.body,
        topics: p.topics,
        scopeType: p.scope_type,
        scopeId: p.scope_id ?? null,
        attrs: p.attrs,
        enforcement: p.enforcement,
        pinned: p.pinned,
        sourceKind: 'proposal',
        sourceRunId: runId,
        sourceProposalId: claimed.id,
        decidedBy: approverUserId,
      },
    )
```

- [ ] **Step 8: Run both suites**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/proposals/apply.test.ts src/domain/memories.test.ts && ./node_modules/.bin/tsc --noEmit`
Expected: all PASS, typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/platform-api/src/domain/memories.ts apps/platform-api/src/proposals/apply.ts apps/platform-api/src/domain/memories.test.ts apps/platform-api/src/proposals/apply.test.ts
git commit -m "feat(memory): persist attrs/enforcement/pinned on rule create (write-path A′)"
```

---

## Task 3: Reflection engine

**Files:**
- Create: `apps/platform-api/src/agent/reflection.ts`
- Create: `apps/platform-api/src/agent/reflection.test.ts`
- Modify: `apps/platform-api/src/routes/agent.ts` (add `POST /api/agent/reflection/run`; follow the existing route-registration pattern in that file)
- Test: `apps/platform-api/src/agent/reflection.test.ts`

**Interfaces:**
- Consumes: `createProposal(sql, CreateProposalInput)` (`proposals/repository.ts`); `getMemoryScoped`/`listMemories` for dedup; the `proposals.reflected_at` column (Task 1); `createMemory` write-path (Task 2, indirectly via apply on accept).
- Produces:
  - `clusterCorrections(corrections: Correction[]): Cluster[]` — pure; groups by `fieldSetKey`, keeps clusters `>= RECURRENCE_THRESHOLD`.
  - `runReflection(sql, { tenantId, now, window?, threshold?, distill }): Promise<ReflectionResult>` — the job. `distill` is an injected async fn `(cluster) => { directive, applies_when } | null` (the LLM, injected so tests mock it).
  - Types: `Correction { proposalId, targetType, payload, editedPayload }`, `Cluster { fieldSetKey, corrections, diffs }`, `ReflectionResult { proposalsCreated: number, ruleProposalIds: string[], consumedProposalIds: string[] }`.

- [ ] **Step 1: Write the failing clustering test**

Create `apps/platform-api/src/agent/reflection.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { clusterCorrections, RECURRENCE_THRESHOLD } from './reflection'

describe('clusterCorrections', () => {
  const corr = (id: string, from: string, to: string) => ({
    proposalId: id,
    targetType: 'work_item',
    payload: { title: from, priority: 'low' },
    editedPayload: { title: to, priority: 'low' },
  })

  it('groups corrections that edit the SAME field-set, keeping only >= threshold', () => {
    const clusters = clusterCorrections([
      corr('p1', 'A very long verbose title', 'Short title'),
      corr('p2', 'Another verbose long title', 'Short title 2'),
      // a single unrelated priority edit — sub-threshold, must NOT cluster
      { proposalId: 'p3', targetType: 'work_item', payload: { priority: 'low' }, editedPayload: { priority: 'high' } },
    ])
    expect(RECURRENCE_THRESHOLD).toBe(2)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.corrections.map((c) => c.proposalId)).toEqual(['p1', 'p2'])
    expect(clusters[0]!.fieldSetKey).toBe('title')
  })

  it('returns no cluster when a field-set occurs only once', () => {
    expect(clusterCorrections([corr('p1', 'x', 'y')])).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/reflection.test.ts`
Expected: FAIL — `./reflection` does not exist.

- [ ] **Step 3: Implement clustering + constants**

Create `apps/platform-api/src/agent/reflection.ts` (clustering first):

```ts
import type { Sql } from '@product-suite/db'
import { createProposal } from '../proposals/repository'

/** Minimum recurrences before a correction pattern becomes a rule proposal. */
export const RECURRENCE_THRESHOLD = 2
/** Lookback window for corrections (days). */
export const REFLECTION_WINDOW_DAYS = 30
/** The provenance stamped on reflection-authored proposals. */
export const REFLECTION_PROMPT_VERSION = 'reflection-v1'

export interface Correction {
  proposalId: string
  targetType: string
  payload: Record<string, unknown>
  editedPayload: Record<string, unknown>
}
export interface FieldDiff {
  field: string
  from: unknown
  to: unknown
}
export interface Cluster {
  fieldSetKey: string
  corrections: Correction[]
  diffs: FieldDiff[]
}

/** The set of fields whose value changed between payload and editedPayload. */
function changedFields(c: Correction): FieldDiff[] {
  const keys = new Set([...Object.keys(c.payload), ...Object.keys(c.editedPayload)])
  const diffs: FieldDiff[] = []
  for (const k of keys) {
    const before = c.payload[k]
    const after = c.editedPayload[k]
    if (JSON.stringify(before) !== JSON.stringify(after)) diffs.push({ field: k, from: before, to: after })
  }
  return diffs
}

/** Cluster corrections by their changed-field-set; keep only clusters >= threshold. */
export function clusterCorrections(corrections: Correction[]): Cluster[] {
  const byKey = new Map<string, { corrections: Correction[]; diffs: FieldDiff[] }>()
  for (const c of corrections) {
    const diffs = changedFields(c)
    if (diffs.length === 0) continue
    const key = diffs.map((d) => d.field).sort((a, b) => a.localeCompare(b)).join('+')
    const entry = byKey.get(key) ?? { corrections: [], diffs: [] }
    entry.corrections.push(c)
    entry.diffs.push(...diffs)
    byKey.set(key, entry)
  }
  const out: Cluster[] = []
  for (const [fieldSetKey, entry] of byKey) {
    if (entry.corrections.length >= RECURRENCE_THRESHOLD) {
      out.push({ fieldSetKey, corrections: entry.corrections, diffs: entry.diffs })
    }
  }
  return out
}
```

- [ ] **Step 4: Run the clustering test to verify it passes**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/reflection.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `runReflection` test**

Append to `reflection.test.ts`:

```ts
import { runReflection } from './reflection'

describe('runReflection', () => {
  // mockSql returns corrections on the SELECT, a minted run on the agent_runs insert,
  // created proposals on the proposals insert, and records the reflected_at UPDATE.
  function harness(corrections: any[]) {
    const created: any[] = []
    const stamped: string[][] = []
    const query = vi.fn(async (text: string, params: any[]) => {
      if (/from "proposals"/i.test(text) && /edited_payload/i.test(text)) return corrections
      if (/insert into "agent_runs"/i.test(text)) return [{ id: 'run_reflect' }]
      if (/insert into "proposals"/i.test(text)) { const row = { id: `rp_${created.length}` }; created.push({ text, params }); return [row] }
      if (/from "memories"/i.test(text)) return [] // dedup: nothing existing
      if (/update "proposals"/i.test(text) && /reflected_at/i.test(text)) { stamped.push(params); return [] }
      if (/update "agent_runs"/i.test(text)) return []
      return []
    })
    const sql = { query } as any
    return { sql, query, created, stamped }
  }

  it('proposes one rule per >=2 cluster, stamps ONLY consumed corrections, mints a reflection run', async () => {
    const corrections = [
      { id: 'p1', target_type: 'work_item', payload: { title: 'long a' }, edited_payload: { title: 'a' } },
      { id: 'p2', target_type: 'work_item', payload: { title: 'long b' }, edited_payload: { title: 'b' } },
      { id: 'p3', target_type: 'work_item', payload: { priority: 'low' }, edited_payload: { priority: 'high' } }, // singleton
    ]
    const { sql, created, stamped } = harness(corrections)
    const distill = vi.fn(async () => ({ directive: 'Prefer concise titles', applies_when: 'work items' }))
    const result = await runReflection(sql, { tenantId: 't_1', now: new Date('2026-07-16T00:00:00Z'), distill })

    expect(result.proposalsCreated).toBe(1)
    expect(distill).toHaveBeenCalledTimes(1) // only the title cluster
    // The reflection run is the proposal actor:
    expect(created[0].params).toContain('run_reflect')
    // Only p1+p2 (the consumed cluster) are stamped; p3 stays NULL:
    const stampedIds = stamped.flat()
    expect(stampedIds).toContain('p1')
    expect(stampedIds).toContain('p2')
    expect(stampedIds).not.toContain('p3')
  })

  it('creates nothing and mints no proposals when no cluster reaches threshold', async () => {
    const { sql, created } = harness([
      { id: 'p1', target_type: 'work_item', payload: { title: 'x' }, edited_payload: { title: 'y' } },
    ])
    const distill = vi.fn(async () => ({ directive: 'd', applies_when: 'w' }))
    const result = await runReflection(sql, { tenantId: 't_1', now: new Date('2026-07-16T00:00:00Z'), distill })
    expect(result.proposalsCreated).toBe(0)
    expect(distill).not.toHaveBeenCalled()
    expect(created).toHaveLength(0)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/reflection.test.ts -t "runReflection"`
Expected: FAIL — `runReflection` not exported.

- [ ] **Step 7: Implement `runReflection`**

Append to `reflection.ts`:

```ts
export interface RunReflectionCtx {
  tenantId: string
  now: Date
  windowDays?: number
  threshold?: number
  /** Injected LLM: distill a cluster into a rule, or null to skip. Tests mock this. */
  distill: (cluster: Cluster) => Promise<{ directive: string; applies_when: string } | null>
  modelId?: string | null
}
export interface ReflectionResult {
  proposalsCreated: number
  ruleProposalIds: string[]
  consumedProposalIds: string[]
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

export async function runReflection(sql: Sql, ctx: RunReflectionCtx): Promise<ReflectionResult> {
  const windowDays = ctx.windowDays ?? REFLECTION_WINDOW_DAYS
  const since = new Date(ctx.now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  // 1. Gather corrections: applied work-item proposals edited by a human, not yet mined.
  const rows = await runQuery<{ id: string; target_type: string; payload: unknown; edited_payload: unknown }>(
    sql,
    `select id, target_type, payload, edited_payload
     from "proposals"
     where tenant_id = $1 and status = 'applied' and target_type = 'work_item'
       and edited_payload is not null and reflected_at is null and created_at >= $2`,
    [ctx.tenantId, since],
  )
  const corrections: Correction[] = rows.map((r) => ({
    proposalId: r.id,
    targetType: r.target_type,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    editedPayload: (r.edited_payload ?? {}) as Record<string, unknown>,
  }))

  const clusters = clusterCorrections(corrections)
  if (clusters.length === 0) return { proposalsCreated: 0, ruleProposalIds: [], consumedProposalIds: [] }

  // 2. Mint the reflection run — the attributable actor (satisfies apply.ts run_id + the
  //    source_run_id FK). triggered_by='reflection' is a reserved sentinel (not a user id).
  const runRows = await runQuery<{ id: string }>(
    sql,
    `insert into "agent_runs" ("tenant_id", "triggered_by", "kind", "status", "memory_holdout")
     values ($1, 'reflection', 'agent_run', 'running', false) returning id`,
    [ctx.tenantId],
  )
  const runId = runRows[0]!.id

  const ruleProposalIds: string[] = []
  const consumedProposalIds: string[] = []
  for (const cluster of clusters) {
    const rule = await ctx.distill(cluster)
    if (!rule) continue // model declined — leave the cluster unmined
    const evidence = cluster.corrections.map((c) => c.proposalId)
    const proposal = await createProposal(sql, {
      tenant_id: ctx.tenantId,
      run_id: runId,
      target_type: 'memory',
      operation: 'create', // dedup→supersede is a fast-follow; create is correct + safe
      payload: {
        kind: 'rule',
        title: rule.directive,
        body: `Learned from ${evidence.length} similar corrections.`,
        attrs: { applies_when: rule.applies_when, evidence_proposal_ids: evidence },
        enforcement: 'advisory',
      },
      rationale: `Recurring correction to [${cluster.fieldSetKey}] across ${evidence.length} proposals.`,
      model_id: ctx.modelId ?? null,
      prompt_version: REFLECTION_PROMPT_VERSION,
      actor_type: 'agent',
      actor_id: runId,
      context_ref: runId,
    })
    ruleProposalIds.push(proposal.id)
    consumedProposalIds.push(...evidence)
  }

  // 3. Stamp ONLY the consumed corrections (sub-threshold ones stay NULL to mature).
  if (consumedProposalIds.length > 0) {
    await runQuery(
      sql,
      `update "proposals" set reflected_at = now() where tenant_id = $1 and id = any($2)`,
      [ctx.tenantId, consumedProposalIds],
    )
  }
  await runQuery(sql, `update "agent_runs" set status = 'completed' where id = $1`, [runId])

  return { proposalsCreated: ruleProposalIds.length, ruleProposalIds, consumedProposalIds }
}
```

- [ ] **Step 8: Run the reflection tests to verify they pass**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/reflection.test.ts`
Expected: all PASS.

- [ ] **Step 9: Wire the route**

In `apps/platform-api/src/routes/agent.ts` (follow the file's existing Hono route pattern + how it resolves `sql`, `tenantId`, and the model client), add a handler that builds the real `distill` (a single LLM call over the cluster's diffs, returning `{directive, applies_when}` or null) and calls `runReflection`:

```ts
// POST /api/agent/reflection/run — mine recent corrections into rule proposals.
app.post('/reflection/run', async (c) => {
  const sql = c.get('sql') // per this file's context accessor
  const tenantId = c.get('tenantId')
  const distill = async (cluster: Cluster) => {
    // One LLM call; prompt: "These proposals were edited the same way (<diffs>).
    // Write one atomic rule: { directive, applies_when }. Reply null if low-signal."
    // Use the same model client this file already constructs; parse strict JSON;
    // return null on unparseable / explicit null.
    return distillRuleFromCluster(cluster, c) // implement alongside, model-injected
  }
  const result = await runReflection(sql, { tenantId, now: new Date(), distill })
  return c.json(result)
})
```

(Keep `distillRuleFromCluster` thin and defensive: strict-JSON parse, return `null` on any failure — a bad LLM reply must skip a cluster, never throw.)

- [ ] **Step 10: Verify typecheck + full api suite**

Run: `cd apps/platform-api && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: exit 0, all green.

- [ ] **Step 11: Commit**

```bash
git add apps/platform-api/src/agent/reflection.ts apps/platform-api/src/agent/reflection.test.ts apps/platform-api/src/routes/agent.ts
git commit -m "feat(agent): reflection engine — learn rule proposals from recurring corrections"
```

---

## Task 4: Rule injection

**Files:**
- Modify: `apps/platform-api/src/agent/memory-retrieval.ts` (add `retrieveRulesForContext` + `fenceRules`)
- Modify: `apps/platform-api/src/agent/runtime.ts` (call it, append the fence, attribute)
- Test: `apps/platform-api/src/agent/memory-retrieval.test.ts`, `apps/platform-api/src/agent/runtime.test.ts`

**Interfaces:**
- Consumes: `buildScopeCascade`, `sanitizeForFence`, `estimateTokens`, `insertAttributions` (existing, `memory-retrieval.ts`).
- Produces: `retrieveRulesForContext(sql, { tenantId, scope?, budget? }): Promise<RetrievalResult>` — selects all active `kind='rule'` in the scope cascade, ordered `pinned desc, priority desc, valid_from desc`, renders `directive — applies when: <attrs.applies_when>` under a Team-rules fence, returns `{ fenced, injected }` where each `injected` also carries `via: 'pinned' | 'retrieved'`. Const `DEFAULT_RULES_TOKEN_BUDGET = 400`.

- [ ] **Step 1: Write the failing retrieval test**

In `apps/platform-api/src/agent/memory-retrieval.test.ts`, add:

```ts
import { retrieveRulesForContext } from './memory-retrieval'

it('injects active rules, pinned first, rendering applies_when, tagging via', async () => {
  const rules = [
    { id: 'r_pin', kind: 'rule', title: 'Never pause design tasks', body: '', attrs: { applies_when: 'all task types' }, pinned: true, priority: 10, scope_type: 'org' },
    { id: 'r_norm', kind: 'rule', title: 'Prefer concise titles', body: '', attrs: { applies_when: 'work items' }, pinned: false, priority: 0, scope_type: 'org' },
  ]
  const query = vi.fn(async (text: string) => (/kind = 'rule'/.test(text) ? rules : []))
  const sql = { query } as any
  const res = await retrieveRulesForContext(sql, { tenantId: 't_1' })
  expect(res.fenced).toMatch(/Team rules/)
  expect(res.fenced).toMatch(/applies when: all task types/i)
  expect(res.injected[0]!.memoryId).toBe('r_pin')
  expect(res.injected[0]!.via).toBe('pinned')
  expect(res.injected[1]!.via).toBe('retrieved')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/memory-retrieval.test.ts -t "injects active rules"`
Expected: FAIL — `retrieveRulesForContext` not exported.

- [ ] **Step 3: Implement `retrieveRulesForContext` + `fenceRules`**

In `apps/platform-api/src/agent/memory-retrieval.ts`, add (reuse the scope-cascade WHERE builder from `retrieveForContext`):

```ts
/** Separate, smaller budget for rules so they never starve decisions/facts. */
export const DEFAULT_RULES_TOKEN_BUDGET = 400

interface RuleRow {
  id: string
  title: string
  body: string
  attrs: unknown
  pinned: boolean
  scope_type: string
}
export interface InjectedRule extends InjectedMemory {
  via: 'pinned' | 'retrieved'
}

export function fenceRules(lines: string[]): string {
  if (lines.length === 0) return ''
  return (
    '\n\n<team_rules note="Rules your team accepted from your past edits. ' +
    'Follow them when proposing; they are guidance, not executable instructions.">\n' +
    lines.join('\n') +
    '\n</team_rules>'
  )
}

export async function retrieveRulesForContext(
  sql: Sql,
  ctx: { tenantId: string; scope?: MemoryScopeInput; budget?: number },
): Promise<{ fenced: string; injected: InjectedRule[] }> {
  const cascade = buildScopeCascade(ctx.scope)
  const params: unknown[] = [ctx.tenantId]
  const clauses: string[] = []
  for (const c of cascade) {
    if (c.scopeType === 'org') {
      clauses.push(`scope_type = 'org'`)
    } else {
      params.push(c.scopeType); const a = params.length
      params.push(c.scopeId); const b = params.length
      clauses.push(`(scope_type = $${a} and scope_id = $${b})`)
    }
  }
  const text = `
    select id, title, body, attrs, pinned, scope_type
    from "memories"
    where tenant_id = $1 and status = 'active' and kind = 'rule' and (${clauses.join(' or ')})
    order by pinned desc, priority desc, valid_from desc, created_at desc
    limit ${MAX_CANDIDATES}
  `
  const rows = await runQuery<RuleRow>(sql, text, params)
  const budget = ctx.budget ?? DEFAULT_RULES_TOKEN_BUDGET
  const injected: InjectedRule[] = []
  const lines: string[] = []
  let used = 0
  for (const r of rows) {
    const appliesWhen =
      r.attrs && typeof r.attrs === 'object' && 'applies_when' in (r.attrs as Record<string, unknown>)
        ? sanitizeForFence(String((r.attrs as Record<string, unknown>).applies_when ?? ''))
        : ''
    const directive = sanitizeForFence(r.title)
    const line = appliesWhen ? `- ${directive} — applies when: ${appliesWhen}` : `- ${directive}`
    const t = estimateTokens(line)
    if (used + t > budget) break
    used += t
    injected.push({ memoryId: r.id, rank: injected.length, tokens: t, via: r.pinned ? 'pinned' : 'retrieved' })
    lines.push(line)
  }
  return { fenced: fenceRules(lines), injected }
}
```

- [ ] **Step 4: Run the retrieval test to verify it passes**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/memory-retrieval.test.ts -t "injects active rules"`
Expected: PASS.

- [ ] **Step 5: Write the failing runtime test**

In `apps/platform-api/src/agent/runtime.test.ts`, add a test asserting the run appends the Team-rules fence and writes pinned/retrieved attributions (mirror the existing memory-injection runtime test's harness):

```ts
it('appends the Team-rules fence and attributes rules by pinned/retrieved', async () => {
  // arrange sql so the rules query returns one pinned rule; capture attributions insert
  // (follow the existing runtime memory-injection test's mock shape)
  // ...
  // assert the system prompt passed to streamText contains "<team_rules"
  // assert an attribution row with injected_via='pinned' was inserted
})
```

(Model the harness on the existing memory-injection test in this file; the two assertions are: the composed `system` string contains `<team_rules`, and `insertAttributions` ran with `via:'pinned'` for the pinned rule.)

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/runtime.test.ts -t "Team-rules fence"`
Expected: FAIL — runtime does not yet inject rules.

- [ ] **Step 7: Wire rules into the runtime**

In `apps/platform-api/src/agent/runtime.ts`, in the memory-injection `try` block (around line 243), after the existing decisions/facts retrieval + attribution, add rules retrieval + attribution and append to the fence:

```ts
    // Team rules (P2a) — the full active in-scope set, own sub-budget, own fence.
    const rules = await retrieveRulesForContext(sql, { tenantId: ctx.tenantId, scope: ctx.scope })
    if (rules.injected.length > 0) {
      // Attribution FIRST (same discipline as decisions), split by pinned vs retrieved.
      const pinned = rules.injected.filter((r) => r.via === 'pinned')
      const retrieved = rules.injected.filter((r) => r.via === 'retrieved')
      if (pinned.length > 0) {
        await insertAttributions(sql, { runId, tenantId: ctx.tenantId, via: 'pinned' },
          pinned.map((m) => ({ memoryId: m.memoryId, rank: m.rank, tokens: m.tokens })))
      }
      if (retrieved.length > 0) {
        await insertAttributions(sql, { runId, tenantId: ctx.tenantId, via: 'retrieved' },
          retrieved.map((m) => ({ memoryId: m.memoryId, rank: m.rank, tokens: m.tokens })))
      }
    }
    memoryFence = memory.fenced + rules.fenced
```

Update the import: `import { insertAttributions, retrieveForContext, retrieveRulesForContext } from './memory-retrieval'`.

- [ ] **Step 8: Run the runtime test + typecheck + full suite**

Run: `cd apps/platform-api && ./node_modules/.bin/vitest run src/agent/runtime.test.ts && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: all PASS, exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/platform-api/src/agent/memory-retrieval.ts apps/platform-api/src/agent/memory-retrieval.test.ts apps/platform-api/src/agent/runtime.ts apps/platform-api/src/agent/runtime.test.ts
git commit -m "feat(agent): inject active team rules (pinned-first, own fence + sub-budget)"
```

---

## Task 5: Inbox UI — rule proposal (evidence + strength) + attribution + revoke

**Files:**
- Create: `apps/platform-web/src/boards/inbox/RuleProposalSurface.tsx`
- Create: `apps/platform-web/src/boards/inbox/RuleAttributionBadge.tsx`
- Modify: `apps/platform-web/src/boards/inbox/ProposalDetail.tsx`
- Test: `apps/platform-web/src/boards/inbox/ProposalDetail.test.tsx`

**Interfaces:**
- Consumes: `Proposal` type (`@/data/proposals`); `useMemories` (`get`, and a `retract` — add to `data/memories/adapter.ts` if missing).
- Produces:
  - `RuleProposalSurface({ proposal })` — renders directive, "applies when" (`payload.attrs.applies_when`), evidence "changed N×" (`payload.attrs.evidence_proposal_ids.length`), and strength controls (advisory/hard toggle + pin checkbox) whose state the parent reads on accept.
  - The accept path composes `edited_payload = { ...originalPayload, enforcement, pinned }` (full merge) when the human changed a control.

- [ ] **Step 1: Write the failing test — rule proposal shows evidence + strength, banner says "Rule logged."**

In `apps/platform-web/src/boards/inbox/ProposalDetail.test.tsx`, add:

```tsx
it("(memory rule) shows 'applies when' + evidence count + strength controls; banner says 'Rule logged.'", async () => {
  itemsMock.items = []
  const accept = vi.fn(async (): Promise<AcceptResult> => ({ outcome: "applied", item: { id: "rule-uuid" } as WorkItem }))
  renderDetail(
    proposal({
      target_type: "memory",
      target_id: null,
      operation: "create",
      payload: {
        kind: "rule",
        title: "Prefer concise titles",
        attrs: { applies_when: "work items in project Foo", evidence_proposal_ids: ["p1", "p2", "p3"] },
        enforcement: "advisory",
      },
    }),
    { accept },
  )
  expect(screen.getByText(/work items in project Foo/)).toBeInTheDocument()
  expect(screen.getByText(/changed 3×/i)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled()
  fireEvent.click(screen.getByRole("button", { name: "Accept" }))
  await waitFor(() => expect(screen.getByText(/Rule logged\./)).toBeInTheDocument())
})
```

- [ ] **Step 2: Write the failing test — accepting after toggling hard merges the FULL payload**

Add:

```tsx
it("(memory rule) toggling hard writes the FULL merged edited_payload on accept", async () => {
  itemsMock.items = []
  const accept = vi.fn(async (): Promise<AcceptResult> => ({ outcome: "applied", item: { id: "r" } as WorkItem }))
  const original = { kind: "rule", title: "Prefer concise titles", attrs: { applies_when: "x", evidence_proposal_ids: ["p1", "p2"] }, enforcement: "advisory" }
  renderDetail(proposal({ target_type: "memory", operation: "create", payload: original }), { accept })
  fireEvent.click(screen.getByRole("button", { name: /mark as hard/i }))
  fireEvent.click(screen.getByRole("button", { name: "Accept" }))
  // accept is called with the proposal id AND a full merged edited_payload (kind+title preserved)
  await waitFor(() => expect(accept).toHaveBeenCalled())
  const editedArg = accept.mock.calls[0]![1] // adjust to the real accept(id, editedPayload?) signature
  expect(editedArg).toMatchObject({ kind: "rule", title: "Prefer concise titles", enforcement: "hard" })
})
```

(If `accept` currently takes only an id, extend the accept flow to accept an optional `editedPayload` and thread it to the mutation — the api already applies `edited_payload`; the web mutation must send it. Verify the real signature in `data/proposals` and adjust this assertion to match.)

- [ ] **Step 3: Run them to verify they fail**

Run: `cd apps/platform-web && ./node_modules/.bin/vitest run src/boards/inbox/ProposalDetail.test.tsx -t "memory rule"`
Expected: FAIL — no rule surface / no strength controls / banner not "Rule logged.".

- [ ] **Step 4: Build `RuleProposalSurface`**

Create `apps/platform-web/src/boards/inbox/RuleProposalSurface.tsx` — render the directive (`payload.title`), an "applies when" row (`payload.attrs.applies_when`), an evidence line ("changed N×" from `payload.attrs.evidence_proposal_ids.length`), and the strength controls (an advisory/hard toggle button labelled "Mark as hard"/"Mark as advisory", and a pin checkbox). Expose the chosen `{ enforcement, pinned }` to the parent via a callback prop `onStrengthChange({ enforcement, pinned })`. Keep it a pure presentational component; the parent owns accept.

- [ ] **Step 5: Wire `ProposalDetail`**

In `ProposalDetail.tsx`:
- Detect a rule proposal: `isMemory && (proposal.payload as any)?.kind === 'rule'` → render `<RuleProposalSurface>` instead of `MemorySurface`.
- Hold `strength` state (default from `payload.enforcement ?? 'advisory'`, `payload.pinned ?? false`); update via `onStrengthChange`.
- On accept, if the human changed strength, build `editedPayload = { ...(proposal.payload as object), enforcement: strength.enforcement, pinned: strength.pinned }` and pass it to the accept mutation (full merge — never a partial). Otherwise accept as-is.
- Banner: extend `memoryAppliedMessage(operation)` (or add a rule branch) so a rule proposal's applied banner reads **"Rule logged."**.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/platform-web && ./node_modules/.bin/vitest run src/boards/inbox/ProposalDetail.test.tsx`
Expected: PASS.

- [ ] **Step 7: Add "Rules active during this run" + revoke**

- Create `RuleAttributionBadge.tsx`: given a proposal whose run has rule attributions (fetch or pass in the joined rule titles), render *"Rules active during this run: [titles]"* — worded as active-during, not caused. Wire it in `ProposalDetail` on a work-item proposal.
- Revoke: ensure `data/memories/adapter.ts` has `retract(id)` → `POST /api/memories/:id/retract`; surface a one-tap "Revoke" on a rule in the memory board (`boards/memory/MemoryListItem.tsx` already has a reactivate button pattern to mirror). Add a test that revoke calls the adapter with the rule id.

- [ ] **Step 8: Typecheck + full web suite**

Run: `cd apps/platform-web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: exit 0, all green.

- [ ] **Step 9: Commit**

```bash
git add apps/platform-web/src/boards/inbox/RuleProposalSurface.tsx apps/platform-web/src/boards/inbox/RuleAttributionBadge.tsx apps/platform-web/src/boards/inbox/ProposalDetail.tsx apps/platform-web/src/boards/inbox/ProposalDetail.test.tsx apps/platform-web/src/data/memories/adapter.ts
git commit -m "feat(inbox): rule proposal UI — evidence + per-rule strength + attribution + revoke"
```

---

## Self-Review

**Spec coverage** (each spec §, and the task that implements it):
- §A Reflection job (headless run mint + createProposal + filter + cluster + gate + stamp-on-emit) → Task 3 ✓
- §A′ Write-path (attrs/enforcement/pinned + full-merge edited_payload) → Task 2 (persist) + Task 5 (merge at accept) ✓
- §B Rule injection (full active set, own select incl. attrs, pinned-first, sub-budget, Team-rules fence, pinned/retrieved attribution) → Task 4 ✓
- §C Applicability (`attrs.applies_when`, displayed + injected) → Task 3 (write) + Task 4 (inject) + Task 5 (display) ✓
- §D UI (evidence "changed N×", strength controls, "Rule logged.", "Rules active during this run", revoke) → Task 5 ✓
- Migration `proposals.reflected_at` → Task 1 ✓

**Deferred (correctly absent):** hard-enforcement gate, holdout/measurement, cron scheduling, dedup→supersede (noted as a fast-follow in Task 3 — `create` is safe meanwhile), free-text rule editing.

**Known follow-ups to raise during build (from the spec's minor notes):**
- Grep every consumer of `agent_runs.triggered_by` to confirm none resolves the `'reflection'` sentinel to a user row.
- Confirm the real `accept(id, editedPayload?)` signature in `data/proposals` and adjust Task 5 Step 2's assertion + the mutation to send `edited_payload`.
- `RECURRENCE_THRESHOLD`/`REFLECTION_WINDOW_DAYS` are named consts (tune later, don't hardcode inline).

**Type consistency check:** `Correction`/`Cluster`/`ReflectionResult` names are consistent across Task 3 steps; `InjectedRule extends InjectedMemory` with `via`; `retrieveRulesForContext` return shape (`{fenced, injected}`) matches its runtime consumer in Task 4.
