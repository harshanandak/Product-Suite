# Agent Slice PR1 — Proposals Kernel + Single Write Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `proposals` table + its exactly-once apply path, applying through the *same* validated domain-command layer the human work-item routes use — the moat's single write path.

**Architecture:** Extract `createWorkItem`/`updateWorkItem` (validation + stamped write) out of the Hono route handlers into `src/domain/work-items.ts`; the routes and the proposals-apply path both call them. A new `proposals` table (with decision-corpus capture columns) plus `/agent/proposals` endpoints (inbox/accept/reject). Accept applies exactly-once via a single Neon `sql.transaction` (status-flip `WHERE status='pending'` + `target_version`-checked write).

**Tech Stack:** Hono on Cloudflare Workers · Neon Postgres (`@neondatabase/serverless@1.x`: `sql.query(text, params)` + non-interactive `sql.transaction([...])`) · Drizzle (schema) · Vitest · Bun.

## Global Constraints

- Neon HTTP is **non-interactive**: no read-then-write in one transaction. Parameterized calls use **`sql.query(text, params)`** (v1.x; the callable `sql(text,params)` form was removed). Tagged templates `sql\`…\`` still valid.
- Tenancy is a **security boundary**: every read/write scoped by `callerTenantIds`; ids never trusted from the client. Reads use `tenant_id = any($tenantIds)`; create anchors to one resolved tenant.
- Provenance already exists (`apps/platform-api/src/provenance/record-write.ts`): `recordWrite(sql, spec, actor)`, `recordWriteTx(sql, specs[], actor)`, `actorAssignments(actor)`, `ActorContext`. **Do not reimplement.** Accepted-proposal writes stamp `actor_type='agent'`, `on_behalf_of`=approver.
- **Do NOT regress** the work-item invariants when extracting: team/status/project ownership, parent same-team + depth-cap-1, self-parent rejection, parent-has-children rejection, team-change-in-hierarchy rejection, and the recursive-CTE reparent **cycle guard** folded into the UPDATE.
- Migrations are hand-authored (additive, `IF NOT EXISTS` guards) + journal entry + snapshot copy — `drizzle-kit generate` is unavailable in the worktree (see [drizzle snapshot drift note]). Next index = **0007** (journal idx 6 is last).
- TDD, frequent commits. Run tests from `apps/platform-api` with `bun run vitest run` and `bun run typecheck`; db tests from `packages/db`.
- Held for founder review when complete (touches merged code + the write-path keystone).

---

## File Structure

- `packages/db/src/schema.ts` — **Modify**: add `proposals` table + enums (`proposal_status`, and reuse `actorTypeEnum`).
- `packages/db/migrations/0007_proposals.sql` — **Create**: hand-authored additive migration.
- `packages/db/migrations/meta/_journal.json` — **Modify**: add idx 7 entry.
- `packages/db/migrations/meta/0007_snapshot.json` — **Create**: copy of 0006 with updated id/prevId (chain-formal; snapshots are ungated).
- `apps/platform-api/src/domain/errors.ts` — **Create**: `DomainError` + code→HTTP-status map.
- `apps/platform-api/src/domain/work-items.ts` — **Create**: `createWorkItem`/`updateWorkItem` commands (validation + stamped write) extracted from the routes.
- `apps/platform-api/src/routes/work-items.ts:136-464` — **Modify**: POST/PATCH handlers become thin (parse → command → map `DomainError`).
- `apps/platform-api/src/proposals/repository.ts` — **Create**: `createProposal`, `listPending`, `getProposal`.
- `apps/platform-api/src/proposals/apply.ts` — **Create**: `applyProposal` (exactly-once) + the operation dispatch to domain commands.
- `apps/platform-api/src/routes/proposals.ts` — **Create**: `GET /`, `POST /:id/accept`, `POST /:id/reject`.
- `apps/platform-api/src/app.ts` — **Modify**: mount `proposalsRoutes` at `/api/agent/proposals`.
- Tests co-located as `*.test.ts` beside each new module + the existing `work-items-writes.test.ts` (must stay green).

---

### Task 1: `proposals` table + migration 0007

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0007_proposals.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/migrations/meta/0007_snapshot.json`
- Test: `packages/db/src/schema.test.ts` (extend)

**Interfaces:**
- Produces: `proposals` Drizzle table export; columns per spec §5 — `id, tenant_id, run_id, target_type, target_id, operation, payload(jsonb), rationale, confidence, risk_level, status, decided_by, decided_at, edited_payload(jsonb), rejection_reason, applied_write(jsonb), target_version(bigint), model_id, prompt_version, context_ref` + provenance (`actor_type, actor_id, on_behalf_of`) + timestamps.

- [ ] **Step 1: Write the failing schema test**

In `packages/db/src/schema.test.ts`, add:
```ts
import { proposals } from './schema'
it('proposals table exposes the decision-corpus + apply columns', () => {
  const cols = Object.keys(proposals)
  for (const c of [
    'id','tenantId','runId','targetType','targetId','operation','payload',
    'riskLevel','status','decidedBy','editedPayload','rejectionReason',
    'targetVersion','modelId','promptVersion','contextRef','actorType',
  ]) expect(cols).toContain(c)
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd packages/db && bun run vitest run src/schema.test.ts`
Expected: FAIL — `proposals` is not exported.

- [ ] **Step 3: Add the table + enum to `schema.ts`**

After the existing enums add:
```ts
export const proposalStatusEnum = pgEnum('proposal_status', [
  'pending','accepted','accepted_with_edits','rejected','superseded','expired','applied',
])
```
Then (reusing `actorTypeEnum`, `timestamps`, `agentRuns`):
```ts
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    // WHAT it wants to change (module-agnostic; validated at APPLY)
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    operation: text('operation').notNull(),
    payload: jsonb('payload').notNull(),
    rationale: text('rationale'),
    confidence: real('confidence'),
    riskLevel: text('risk_level'), // placeholder for the future policy engine
    // lifecycle
    status: proposalStatusEnum('status').notNull().default('pending'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    editedPayload: jsonb('edited_payload'), // the payload ACTUALLY applied (gold-label diff)
    rejectionReason: text('rejection_reason'),
    appliedWrite: jsonb('applied_write'),
    targetVersion: bigint('target_version', { mode: 'number' }),
    // generation metadata (measure model/prompt swaps)
    modelId: text('model_id'),
    promptVersion: text('prompt_version'),
    contextRef: text('context_ref'), // → the retrieval set shown to the model
    // provenance (companion doc)
    actorType: actorTypeEnum('actor_type').notNull().default('agent'),
    actorId: text('actor_id'),
    onBehalfOf: text('on_behalf_of'),
    ...timestamps,
  },
  (t) => ({
    byInbox: index('proposals_tenant_status_idx').on(t.tenantId, t.status),
    byRun: index('proposals_run_idx').on(t.runId),
    byTarget: index('proposals_target_idx').on(t.targetType, t.targetId),
  }),
)
```
Add `jsonb`, `bigint`, `real` to the `drizzle-orm/pg-core` import if missing.

- [ ] **Step 4: Run schema test + typecheck, verify pass**

Run: `cd packages/db && bun run vitest run src/schema.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Hand-author `0007_proposals.sql`**

```sql
-- Proposals kernel (see docs/design/2026-07-13-agent-slice-v1-design.md §5).
-- Additive. Module-agnostic proposal rows + decision-corpus capture columns.
DO $$ BEGIN
 CREATE TYPE "public"."proposal_status" AS ENUM('pending','accepted','accepted_with_edits','rejected','superseded','expired','applied');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"rationale" text,
	"confidence" real,
	"risk_level" text,
	"status" "public"."proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"edited_payload" jsonb,
	"rejection_reason" text,
	"applied_write" jsonb,
	"target_version" bigint,
	"model_id" text,
	"prompt_version" text,
	"context_ref" text,
	"actor_type" "public"."actor_type" DEFAULT 'agent' NOT NULL,
	"actor_id" text,
	"on_behalf_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_tenant_status_idx" ON "proposals" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_run_idx" ON "proposals" ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_target_idx" ON "proposals" ("target_type","target_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 6: Journal + snapshot**

Add to `meta/_journal.json` entries array (after idx 6):
```json
{ "idx": 7, "version": "7", "when": 1784131200000, "tag": "0007_proposals", "breakpoints": true }
```
Then: `cp packages/db/migrations/meta/0006_snapshot.json packages/db/migrations/meta/0007_snapshot.json` and edit its top `"id"` to a new uuid and `"prevId"` to 0006's `id` (`a6f0e6c2-0006-4a00-9000-000000000006`). (Snapshots are ungated; this keeps the chain formal.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/migrations/0007_proposals.sql packages/db/migrations/meta/
git commit -m "feat(db): proposals table + migration 0007 (decision-corpus capture)"
```

---

### Task 2: `DomainError` + `createWorkItem` command (extract from POST)

**Files:**
- Create: `apps/platform-api/src/domain/errors.ts`
- Create: `apps/platform-api/src/domain/work-items.ts`
- Modify: `apps/platform-api/src/routes/work-items.ts:136-239` (POST handler)
- Test: `apps/platform-api/src/domain/work-items.test.ts` (create), plus keep `routes/work-items-writes.test.ts` green.

**Interfaces:**
- Produces:
  - `class DomainError extends Error { code: DomainErrorCode }` and `domainErrorStatus(code): 400|404`.
  - `interface WriteContext { actor: ActorContext }` (from provenance) — create adds `tenantId: string`; update adds `tenantIds: string[]`.
  - `createWorkItem(sql: Sql, ctx: { tenantId: string; actor: ActorContext }, input: CreateWorkItemInput): Promise<WorkItemRow>` — validates team/status/parent ownership + depth cap, generates the id client-side, writes the item + `created` activity event via `recordWriteTx`. Throws `DomainError` on any invariant violation.
  - `interface CreateWorkItemInput { title?; description?; phase?; type?; priority?; tags?; project_id?; team_id: string; status_id: string; parent_id?: string|null; department?; assignee_id?; due_date?; archived? }`

- [ ] **Step 1: Write the failing command test**

`apps/platform-api/src/domain/work-items.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import type { Sql } from '@product-suite/db'
import { createWorkItem } from './work-items'
import { DomainError } from './errors'

const actor = { actorType: 'human', actorId: 'u_1' } as const

it('rejects a team not in the caller tenant with DomainError unknown_team', async () => {
  const sql = vi.fn(async () => []) as unknown as Sql // ownedTeam check → []
  await expect(
    createWorkItem(sql, { tenantId: 't_1', actor }, { team_id: 'team_x', status_id: 's_1' }),
  ).rejects.toMatchObject({ code: 'unknown_team' })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd apps/platform-api && bun run vitest run src/domain/work-items.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `errors.ts`**

```ts
export type DomainErrorCode =
  | 'unknown_team' | 'unknown_status' | 'unknown_project' | 'unknown_parent'
  | 'parent_different_team' | 'max_depth' | 'self_parent' | 'parent_has_children'
  | 'cannot_change_team_in_hierarchy' | 'cycle' | 'not_found'

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

export function domainErrorStatus(code: DomainErrorCode): 400 | 404 {
  return code === 'not_found' ? 404 : 400
}
```

- [ ] **Step 4: Write `createWorkItem`** by MOVING the POST body's logic (validation + id-gen + `recordWriteTx`) from `routes/work-items.ts:156-234` into `domain/work-items.ts`, replacing each `return c.json({error:'…'}, 400)` with `throw new DomainError('<code>', '…')`. Structure:

```ts
import type { Sql } from '@product-suite/db'
import { recordWriteTx, type ActorContext } from '../provenance/record-write'
import { DomainError } from './errors'
// … WorkItemRow interface moved/shared from routes …

export interface CreateWorkItemInput { /* fields as in Interfaces */ }

export async function createWorkItem(
  sql: Sql,
  ctx: { tenantId: string; actor: ActorContext },
  input: CreateWorkItemInput,
): Promise<WorkItemRow> {
  const { tenantId, actor } = ctx
  if (!input.team_id) throw new DomainError('unknown_team', 'team_id is required')
  const ownedTeam = (await sql`select 1 from teams where id = ${input.team_id} and tenant_id = ${tenantId}`) as unknown[]
  if (ownedTeam.length === 0) throw new DomainError('unknown_team', 'Unknown team')
  // … status check → DomainError('unknown_status') …
  // … project check → DomainError('unknown_project') …
  // … parent checks → DomainError('unknown_parent' | 'parent_different_team' | 'max_depth') …
  const workItemId = crypto.randomUUID()
  const title = input.title ?? 'Untitled work item'
  const [created] = await recordWriteTx<WorkItemRow>(sql, [
    { table: 'work_items', operation: 'insert', values: { id: workItemId, tenant_id: tenantId, title, /* …rest… */ } },
    { table: 'activity_events', operation: 'insert', values: { id: crypto.randomUUID(), work_item_id: workItemId, kind: 'created', summary: `Created “${title}”` } },
  ], actor)
  if (!created) throw new DomainError('not_found', 'insert returned no row')
  return created
}
```
(Preserve the exact validation queries + depth logic from the current route.)

- [ ] **Step 5: Make the POST route thin**

Replace `routes/work-items.ts` POST body (after resolving `tenantId`) with:
```ts
try {
  const created = await createWorkItem(sql, { tenantId, actor: { actorType: 'human', actorId } }, body)
  return c.json(toWorkItem(created), 201)
} catch (cause) {
  if (cause instanceof DomainError) return c.json({ error: cause.message }, domainErrorStatus(cause.code))
  console.error('[work-items] create failed', cause); return c.json({ error: 'Failed to create work item' }, 500)
}
```
(Keep the `callerTenantIds` ambiguity/`403` checks + `callerUserId` → `actorId` resolution in the route.)

- [ ] **Step 6: Run command test + the existing writes suite + typecheck**

Run: `cd apps/platform-api && bun run vitest run src/domain/work-items.test.ts src/routes/work-items-writes.test.ts && bun run typecheck`
Expected: PASS (the existing POST tests still pass — behavior unchanged, just relocated).

- [ ] **Step 7: Commit**

```bash
git add apps/platform-api/src/domain apps/platform-api/src/routes/work-items.ts
git commit -m "refactor(domain): extract createWorkItem command (single write path)"
```

---

### Task 3: `updateWorkItem` command (extract from PATCH, keep the cycle guard)

**Files:**
- Modify: `apps/platform-api/src/domain/work-items.ts` (add `updateWorkItem`)
- Modify: `apps/platform-api/src/routes/work-items.ts:285-465` (PATCH handler)
- Test: `apps/platform-api/src/domain/work-items.test.ts` (add cases)

**Interfaces:**
- Produces: `updateWorkItem(sql, ctx: { tenantIds: string[]; actor: ActorContext }, id: string, patch: UpdateWorkItemInput): Promise<WorkItemRow>` — fetches the row scoped to `tenantIds`, applies the same team/status/project + parent + **recursive-CTE cycle guard** as today, stamps `actor_*` inline (Tier-2 escape hatch), writes the `updated` activity event via `recordWrite`. Throws `DomainError('not_found')` if not owned, `DomainError('cycle')` when the guard blocks a parent-set.

- [ ] **Step 1: Write the failing test — cycle guard preserved**

```ts
it('throws DomainError cycle when the reparent guard blocks (update returns no row after a settingParent)', async () => {
  const sql = vi.fn()
  sql.mockResolvedValueOnce([{ id: 'wi_1', team_id: 'team_1', parent_id: null, depth: 0 /* …WI_ROW… */ }]) // scoped select
    .mockResolvedValueOnce([]) // child-check: no children
    .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: null }]) // parent lookup
    .mockResolvedValueOnce([]) // the guarded UPDATE returns 0 rows (cycle blocked)
  await expect(
    updateWorkItem(sql as never, { tenantIds: ['t_1'], actor }, 'wi_1', { parent_id: 'wi_anc' }),
  ).rejects.toMatchObject({ code: 'cycle' })
})
```

- [ ] **Step 2: Run it, verify it fails.** Run: `cd apps/platform-api && bun run vitest run src/domain/work-items.test.ts` → FAIL (`updateWorkItem` undefined).

- [ ] **Step 3: Write `updateWorkItem`** by MOVING `routes/work-items.ts:285-460` logic in, replacing `c.json(…,4xx)` with `DomainError`, keeping the array-scoped select, all parent/team guards, the actor_* inline stamping, the recursive-CTE UPDATE verbatim, and the `settingParent ? 'cycle' : 'not_found'` branch on 0-rows. The activity event stays `recordWrite(sql, { table:'activity_events', operation:'insert', values:{…} }, actor)`.

- [ ] **Step 4: Make the PATCH route thin** — resolve `tenantIds`+`actorId` in the route, then:
```ts
try {
  const updated = await updateWorkItem(sql, { tenantIds, actor: { actorType: 'human', actorId } }, id, patch)
  return c.json(toWorkItem(updated))
} catch (cause) {
  if (cause instanceof DomainError) return c.json({ error: cause.message }, domainErrorStatus(cause.code))
  console.error('[work-items] update failed', cause); return c.json({ error: 'Failed to update work item' }, 500)
}
```

- [ ] **Step 5: Run domain + writes suites + typecheck** → all PASS (PATCH behavior unchanged).

- [ ] **Step 6: Commit** — `refactor(domain): extract updateWorkItem command (keeps cycle guard)`.

---

### Task 4: proposals repository (create / list / get)

**Files:**
- Create: `apps/platform-api/src/proposals/repository.ts`
- Test: `apps/platform-api/src/proposals/repository.test.ts`

**Interfaces:**
- Produces:
  - `interface ProposalRow { id; tenant_id; run_id; target_type; target_id; operation; payload; status; decided_by; edited_payload; target_version; … }`
  - `createProposal(sql, values): Promise<ProposalRow>` (via `sql.query` insert `returning *`).
  - `listPending(sql, tenantIds: string[]): Promise<ProposalRow[]>` — `WHERE tenant_id = any($1) AND status='pending'`.
  - `getProposalScoped(sql, id, tenantIds): Promise<ProposalRow|null>`.

- [ ] **Step 1: Failing test** — `listPending` scopes by tenant array + status:
```ts
it('listPending scopes by tenant array and pending status', async () => {
  const sql = vi.fn(async () => [{ id: 'p1' }]) as unknown as Sql
  const rows = await listPending(sql, ['t_1'])
  expect(rows).toHaveLength(1)
  const params = (sql as any).mock.calls[0].slice(1)
  expect(params[0]).toEqual(['t_1'])
})
```
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement `repository.ts`** — tagged-template `sql\`select … where tenant_id = any(${tenantIds}) and status='pending' order by created_at\``; `createProposal` builds an insert. Keep `getProposalScoped` joining tenant scope.
- [ ] **Step 4: Run, verify pass + typecheck.**
- [ ] **Step 5: Commit** — `feat(proposals): repository (create/list/get, tenant-scoped)`.

---

### Task 5: exactly-once `applyProposal` (the crux)

> **SUPERSEDED — implemented as Design C (claim-then-command), see design doc §14.**
> The single-`sql.transaction` sketch below is infeasible (the domain command does
> read-then-write; Neon batches are non-interactive) and would fork the §4 write path.
> As built: (1) atomic CLAIM `UPDATE … WHERE status='pending' RETURNING *` (0 rows ⇒
> `not_pending`); (2) *only the winner* calls the shared `createWorkItem`/`updateWorkItem`;
> (3) compensate on `DomainError`, guarded by `status='applied' AND decided_by=$me` —
> `stale`→`pending`, otherwise→terminal `failed`. `work_items.applied_from_proposal_id`
> UNIQUE makes a post-crash re-drive idempotent.

**Files:**
- Create: `apps/platform-api/src/proposals/apply.ts`
- Test: `apps/platform-api/src/proposals/apply.test.ts`

**Interfaces:**
- Consumes: `createWorkItem`/`updateWorkItem` (Task 2/3), `getProposalScoped` (Task 4).
- Produces: `applyProposal(sql, ctx: { tenantIds; approverUserId }, proposalId): Promise<{ applied: true; result: WorkItemRow } | { applied: false; reason: 'not_pending'|'stale'|'invalid' }>`. Dispatches on `(target_type, operation)`; the write goes through the domain command with `actor = { actorType:'agent', actorId: run_id, onBehalfOf: approverUserId, runId: run_id }`; the whole apply is ONE `sql.transaction`: (1) `UPDATE proposals SET status='applied', decided_by=$approver, decided_at=now(), edited_payload=$payload WHERE id=$id AND status='pending' RETURNING *` (0 rows ⇒ `not_pending`, no-op); (2) the domain write, conditioned on `target_version` for updates. Any guard miss ⇒ the batch fails ⇒ surfaced (409/`stale`|`invalid`), proposal stays pending.

- [ ] **Step 1: Failing test — idempotent double-accept is a no-op**
```ts
it('a second accept of an already-applied proposal is a no-op (status flip guards it)', async () => {
  // transaction mock: first call flips 1 row; second call flips 0 rows
  const tx = vi.fn()
    .mockResolvedValueOnce([[{ id: 'p1', operation: 'create', target_type: 'work_item', payload: {} }], [{ id: 'wi_1' }]])
    .mockResolvedValueOnce([[], []]) // status flip matched nothing
  const sql = { transaction: tx, /* getProposalScoped stub via tagged calls */ } as unknown as Sql
  // …drive applyProposal twice, assert second → { applied:false, reason:'not_pending' }
})
```
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement `applyProposal`** — load the proposal (scoped), build the `(status-flip, domain-write)` batch via `sql.transaction`, dispatch operation→command, map failures to `stale`/`invalid`. Generate the target write conditioned on `target_version` (pass through to `updateWorkItem`'s WHERE for updates; creates have no version).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Add the concurrent-accept test** — two `applyProposal` calls racing on one pending proposal: exactly one returns `{applied:true}`, the other `{applied:false, reason:'not_pending'}`; assert the domain write ran once. Run, verify pass + typecheck.
- [ ] **Step 6: Commit** — `feat(proposals): exactly-once apply via single Neon transaction (+concurrent test)`.

---

### Task 6: `/agent/proposals` endpoints (inbox / accept / reject)

**Files:**
- Create: `apps/platform-api/src/routes/proposals.ts`
- Modify: `apps/platform-api/src/app.ts` (mount at `/api/agent/proposals`)
- Test: `apps/platform-api/src/routes/proposals.test.ts`

**Interfaces:**
- `GET /` → `listPending(sql, callerTenantIds)`; `POST /:id/accept` → `applyProposal(...)` mapping `{applied:false}` reasons to 409; `POST /:id/reject` → set `status='rejected', decided_by, rejection_reason` (scoped update). All behind `clerkAuth`; `callerUserId` = approver.

- [ ] **Step 1: Failing test** — `GET /api/agent/proposals` returns the caller's pending proposals (401 without token; tenant-scoped). Mirror `teams.test.ts` harness (`vi.mock('@clerk/backend')`, `vi.mock('@product-suite/db')`).
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement `proposals.ts` routes** + mount in `app.ts`.
- [ ] **Step 4: Add accept (200 applied / 409 not_pending|stale) + reject tests.** Run, verify pass + typecheck.
- [ ] **Step 5: Commit** — `feat(proposals): inbox/accept/reject endpoints`.

---

## Self-Review

- **Spec coverage:** proposals table+capture (§5) → Task 1; single write path (§4) → Tasks 2–3; apply endpoints + optimistic concurrency (§16.1) → Tasks 4–6; exactly-once (§14) → Task 5. Agent runtime/tools/UI are **PR2–PR4**, out of this plan. ✓
- **Placeholder scan:** the extraction tasks say "MOVE lines X–Y … replacing `c.json(4xx)` with `DomainError`" — an explicit move of existing, verified logic, not a "TODO"; the load-bearing NEW code (migration SQL, errors.ts, apply transaction, tests) is shown in full. ✓
- **Type consistency:** `WriteContext` is create=`{tenantId}` / update=`{tenantIds}` by design (create anchors one org; update matches the array) — noted in both Interfaces blocks. `ActorContext`, `recordWrite(sql, spec, actor)`, `recordWriteTx(sql, specs[], actor)` match the merged provenance module. `ProposalRow` snake_case matches the migration columns. ✓

## Execution Handoff

Two execution options — **(1) Subagent-Driven** (fresh subagent per task, review between) or **(2) Inline** (executing-plans, checkpoints). Recommend Subagent-Driven: Task 5 (exactly-once) deserves its own reviewer gate, and the extraction tasks (2–3) must be verified against the untouched `work-items-writes.test.ts` before proceeding.
