import { z } from 'zod'

import type { AcceptResult } from '@product-suite/contracts'
import type { Sql } from '@product-suite/db'

import { DomainError } from '../domain/errors'
import {
  createMemory,
  deferMemory,
  getMemoryBySourceProposalId,
  retractMemory,
  supersedeMemory,
  type MemoryRow,
} from '../domain/memories'
import {
  createWorkItem,
  resolveDefaultTeamId,
  updateWorkItem,
  type CreateWorkItemInput,
  type UpdateWorkItemInput,
  type WorkItemRow,
} from '../domain/work-items'
import type { ActorContext } from '../provenance/record-write'
import { getProposalScoped, type ProposalRow } from './repository'
import { buildUndoEnvelope, fieldSnapshot, undoableKeys } from './undo'

/**
 * `applyProposal` returns the shared {@link AcceptResult} envelope (defined in
 * `@product-suite/contracts` so the Review Inbox imports the SAME type) — a stable,
 * UX-legible discriminated union, never a raw 500. Variants: `applied` (exactly once),
 * `invalid` (a fixable payload/field problem; a recoverable one stays `pending`, a
 * permanent structural defect is terminally `failed` server-side), `stale` (the target
 * moved — stays reviewable), `not_found`, `not_pending`. The route maps `status` →
 * HTTP via {@link acceptHttpStatus} and ALWAYS emits the envelope in the body.
 */

/**
 * The HTTP status the accept route returns for an {@link AcceptResult}. `failed` splits
 * on `retryable`: a genuine (transient) server fault → 500 so it SHOULD alert; a
 * deterministic non-retryable failure → 422 (unprocessable, NOT a server error) so it
 * never pollutes 5xx dashboards. 5xx is reserved for real server faults; 4xx covers
 * deterministic bad/undeliverable proposals.
 */
export function acceptHttpStatus(result: AcceptResult): 200 | 404 | 409 | 422 | 500 {
  switch (result.status) {
    case 'applied':
      return 200
    case 'invalid':
      return 422
    case 'stale':
    case 'not_pending':
      return 409
    case 'not_found':
      return 404
    case 'failed':
      return result.retryable ? 500 : 422
  }
}

/**
 * Runtime shapes for the three memory payloads that carry data. `payload`/`edited_payload`
 * are `unknown` JSON — a human could edit `topics` to a bare string or `review_after` to a
 * number, which the domain casts would forward straight to a `timestamptz`/`text[]` bind and
 * cast-error into a 500 that leaves the proposal `applied`-without-a-write. We parse each
 * payload HERE and convert any mismatch to `invalid_input`. The parse runs inside the
 * write-first try, so a mismatch is CLASSIFIED as a recoverable `invalid` decline (the
 * proposal stays `pending` for the human to correct + re-accept) — not a terminal `failed`.
 * A malformed edit is a clean rejection, never a wedge. Domain commands still do the deeper
 * checks (non-empty title, UUID scope_id, ISO `review_after`); this layer only fixes TYPES.
 */
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
const memoryDeferPayload = z.object({
  waiting_on: z.string().optional(),
  review_after: z.string().optional(),
})

/** Parse a memory payload, mapping a shape mismatch to `invalid_input` (never a raw ZodError). */
function parseMemoryPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw new DomainError('invalid_input', `invalid memory payload — ${where}${issue?.message ?? 'validation failed'}`)
  }
  return parsed.data
}

/** The (target_type, operation) pairs this slice can apply. */
const SUPPORTED = new Set([
  'work_item:create',
  'work_item:update',
  'memory:create',
  'memory:supersede',
  'memory:retract',
  'memory:defer',
])

/** Run a parameterized statement via neon's `sql.query(text, params)` (v1.x). */
function sqlQuery<Row = Record<string, unknown>>(
  sql: Sql,
  text: string,
  params: unknown[],
): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * Terminally fail a permanently-invalid proposal (a structural pre-check failure that
 * no payload edit can fix) and report it as `invalid` with `retryable:false` — a DECIDED
 * decline the Inbox renders with Discard/acknowledge only (never Retry/Edit). The DB row
 * is flipped to `failed` so it leaves `listPending`; the flip is GUARDED on
 * `status='pending'` so it is a no-op if the proposal was already decided — it never
 * resurrects or re-decides a row.
 */
async function failTerminal(sql: Sql, proposalId: string, message: string): Promise<AcceptResult> {
  await sqlQuery(
    sql,
    `update proposals set status = 'failed', rejection_reason = $1, updated_at = now()
     where id = $2 and status = 'pending'`,
    [message, proposalId],
  )
  return { status: 'invalid', proposal_id: proposalId, message, retryable: false }
}

/** Canonical 8-4-4-4-12 UUID (any version). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True when a value is a well-formed UUID string — safe to bind to a `uuid` column
 *  without risking a Postgres `22P02` cast error. A non-string / blank / slug is not. */
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

/**
 * A Postgres DATA error (bad value, not a bug/outage): `22xxx` (e.g. `22P02`, an
 * invalid-uuid cast — the exact class this wave stops leaking as a 500) or `23xxx`
 * (constraint violation). neon surfaces the SQLSTATE on `.code`; the message regex is
 * a fallback for wrappers that drop it. A data error means the PAYLOAD is bad, so it
 * classifies to `invalid` (4xx); anything else is genuinely unexpected → rethrow → 500.
 */
function isPgDataError(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code
  if (typeof code === 'string' && (code.startsWith('22') || code.startsWith('23'))) return true
  const message = cause instanceof Error ? cause.message : String(cause)
  return /invalid input syntax|violates .* constraint|out of range/i.test(message)
}

/**
 * Accept-time validation + default-resolution for a `work_item` proposal, BEFORE the
 * write. Every id that will bind to a `uuid` column (team_id, status_id, project_id,
 * parent_id) must be a well-formed UUID here — otherwise a slug like `team_id='open'`
 * reaches the query and Postgres raises `22P02` as a raw 500 that escapes the domain
 * layer (the 2b91cd2c bug). A present-but-malformed id is a FIXABLE `invalid_input`
 * (the caller returns `invalid` and the proposal stays `pending` for correction).
 *
 * Folds 6055d30e: an ABSENT `team_id` on a create resolves the caller's SOLE team
 * (`resolveDefaultTeamId`) and SNAPSHOTS the resolved id into the returned payload, so
 * the flip can persist it into `edited_payload` and any re-drive uses the SAME team id
 * deterministically — even if a 2nd team is added later (no schema change). Existence
 * of each id is still enforced downstream by the domain command, which now throws a
 * typed `DomainError` (a clean 4xx) instead of a 500.
 */
async function validateAndResolveWorkItemPayload(
  sql: Sql,
  tenantId: string,
  operation: string,
  payload: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; snapshot: boolean }> {
  // The memory path is zod-guarded (parseMemoryPayload); the work_item path is not, so a
  // human/agent-edited payload that is an array or scalar (`typeof [] === 'object'` slips
  // past the route's object check) would otherwise reach createWorkItem as `[]` and land an
  // "Untitled work item". Reject a non-plain-object payload as a FIXABLE `invalid` here.
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new DomainError('invalid_input', 'work item payload must be an object')
  }
  for (const field of ['status_id', 'project_id', 'parent_id'] as const) {
    const v = payload[field]
    if (v !== undefined && v !== null && !isUuid(v)) {
      throw new DomainError('invalid_input', `${field} must be a valid id`)
    }
  }
  if (operation === 'create') {
    // ABSENT team_id → resolve the sole team + snapshot it (6055d30e). PRESENT →
    // must be a well-formed UUID (a blank/slug id is a clean decline, not a 500).
    if (payload.team_id === undefined) {
      const teamId = await resolveDefaultTeamId(sql, tenantId) // throws team_required_multiple / no_team
      return { payload: { ...payload, team_id: teamId }, snapshot: true }
    }
    if (!isUuid(payload.team_id)) throw new DomainError('invalid_input', 'team_id must be a valid id')
    return { payload, snapshot: false }
  }
  // update: a team_id in the patch is optional, but must be well-formed when present.
  if (payload.team_id !== undefined && payload.team_id !== null && !isUuid(payload.team_id)) {
    throw new DomainError('invalid_input', 'team_id must be a valid id')
  }
  return { payload, snapshot: false }
}

/**
 * Classify a write failure into a decision outcome WITHOUT touching the proposal. The
 * write ran while the proposal was still `pending` (we flip only AFTER success), so
 * every classified failure leaves it re-acceptable — the "applied-without-a-row" ghost
 * state is unreachable. `stale`/`conflict` (the target moved) → `stale` (reviewable).
 * Any other `DomainError`, and any raw pg DATA error (a `22P02` malformed uuid that
 * slipped past accept-time validation, a constraint violation), → `invalid` (bad
 * payload, 4xx). A genuinely unexpected error (connection/bug) is rethrown → the
 * route's 500; the proposal stays `pending` and a re-accept re-drives idempotently.
 */
function classifyWriteFailure(cause: unknown, proposal: ProposalRow): AcceptResult {
  const proposalId = proposal.id
  if (cause instanceof DomainError) {
    if (cause.code === 'stale' || cause.code === 'conflict') {
      return { status: 'stale', proposal_id: proposalId, item_id: proposal.target_id, message: cause.message }
    }
    // A domain-invariant violation is a RECOVERABLE decline — the write never flipped, so
    // the proposal is still pending; the human corrects the payload and re-accepts.
    return { status: 'invalid', proposal_id: proposalId, message: cause.message, retryable: true }
  }
  if (isPgDataError(cause)) {
    return {
      status: 'invalid',
      proposal_id: proposalId,
      message: 'a field references something that no longer exists',
      retryable: true,
    }
  }
  throw cause
}

/**
 * Dispatch an accepted `target_type='memory'` proposal to the memory DOMAIN commands
 * (the single validated write path — never raw SQL), as the AGENT acting on behalf of
 * the approver. `created_by`/actor is the RUN (the agent's identity), `decided_by` is
 * the approver, and created/superseded memories carry `source_kind='proposal'` +
 * `source_proposal_id`/`source_run_id` so an agent-authored memory is fully accountable.
 *
 * Idempotent re-drive (create only): before creating, look up a memory already made
 * from THIS proposal (`source_proposal_id`) — the memory analogue of
 * `work_items.applied_from_proposal_id` — and return it, so a crash between the claim
 * and the write can never double-create. The lookup is scoped to the proposal's OWN
 * tenant; every command is likewise `tenantIds=[claimed.tenant_id]`, so a foreign
 * target id is indistinguishable from unknown (→ `not_found`) and never applied — the
 * apply is the tenant boundary, not just the tool.
 */
async function applyMemoryCommand(
  sql: Sql,
  claimed: ProposalRow,
  payload: Record<string, unknown>,
  approverUserId: string,
): Promise<MemoryRow> {
  const tenantId = claimed.tenant_id
  const runId = claimed.run_id as string // guaranteed by the run_id pre-check
  const targetId = claimed.target_id as string // guaranteed by the target pre-check (non-create)

  if (claimed.operation === 'create') {
    const existing = await getMemoryBySourceProposalId(sql, claimed.id, [tenantId])
    if (existing) return existing
    const p = parseMemoryPayload(memoryCreatePayload, payload)
    try {
      return await createMemory(
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
    } catch (cause) {
      // Idempotent converge (mirrors createWorkItem's applied_from_proposal_uniq catch):
      // the check-then-insert above races a concurrent re-drive, so a second accept can
      // slip past the `existing` lookup and both attempt the create. The partial-unique
      // index `memories_source_proposal_uniq` (23505) rejects the loser — return the
      // winning row, so the apply is exactly-once (converge), never a misreported `invalid`.
      const code = (cause as { code?: unknown } | null)?.code
      const message = cause instanceof Error ? cause.message : String(cause)
      if (code === '23505' || message.includes('memories_source_proposal_uniq')) {
        const converged = await getMemoryBySourceProposalId(sql, claimed.id, [tenantId])
        if (converged) return converged
      }
      throw cause
    }
  }
  if (claimed.operation === 'supersede') {
    const p = parseMemoryPayload(memorySupersedePayload, payload)
    return supersedeMemory(
      sql,
      { tenantIds: [tenantId], actor: runId },
      targetId,
      {
        title: p.title,
        body: p.body,
        topics: p.topics,
        changeReason: p.change_reason ?? '',
        sourceKind: 'proposal',
        sourceRunId: runId,
        sourceProposalId: claimed.id,
        // The new version records the APPROVER, not the old row's decider.
        decidedBy: approverUserId,
      },
    )
  }
  if (claimed.operation === 'retract') {
    return retractMemory(sql, { tenantIds: [tenantId], actor: runId }, targetId)
  }
  const p = parseMemoryPayload(memoryDeferPayload, payload)
  return deferMemory(
    sql,
    { tenantIds: [tenantId], actor: runId },
    targetId,
    {
      waitingOn: p.waiting_on ?? null,
      reviewAfter: p.review_after ?? null,
    },
  )
}

/**
 * Apply a pending proposal EXACTLY ONCE, through the SAME validated domain command
 * the human UI uses — the moat's single write path. Sequence: **write-first, flip-last**
 * (the 2b91cd2c fix). The old order claimed (`status→applied`) BEFORE the write, so a
 * raw pg `22P02` (a slug bound to a `uuid` column) escaped the `DomainError`-only catch
 * as a 500 and stranded the proposal `applied` with no row. Reordered so the dangerous
 * "applied-without-a-row" state is unreachable:
 *
 *  1. LOAD scoped (`not_found` if not the caller's) and guard `pending`.
 *  2. STRUCTURAL pre-checks — PERMANENT defects (unsupported op, no run, missing/
 *     malformed target) that no payload edit can fix → terminal `failed` (guarded flip),
 *     so they leave `listPending`.
 *  3. ACCEPT-TIME VALIDATION + resolution (work_item) — every id that binds to a `uuid`
 *     column must be well-formed here; a malformed/absent-but-ambiguous id is a FIXABLE
 *     `invalid` and the proposal STAYS `pending`. This kills the `22P02` 500 class at the
 *     door. Folds 6055d30e: resolve the sole team when `team_id` is omitted and snapshot it.
 *  4. WRITE FIRST — dispatch the domain command while the proposal is still `pending`, so
 *     ANY failure leaves it re-acceptable. Create is idempotent (unique index on
 *     `applied_from_proposal_id` → a re-drive returns the existing row). Update has NO
 *     version guard today — `expectedVersion` is threaded through but is a deliberate
 *     no-op (v1 `work_items` has no version column; see `updateWorkItem`), so an update
 *     applies last-writer-wins; proactive staleness detection is deferred to the staleness
 *     epic (kernel a41345b4). A failure is CLASSIFIED without touching the proposal
 *     (`stale`/`conflict` → reviewable; other/data error → `invalid`; unexpected → rethrow→500).
 *  5. FLIP LAST — only on write success, ONE guarded `UPDATE … WHERE status='pending'`
 *     stamps `decided_by/at`, the (coalesced) edited/snapshot payload, and `applied_write`.
 *     It is the single exactly-once winner-gate: concurrent accepts both run the idempotent
 *     write, but only one flip matches `pending` (the rest → `not_pending`, harmless — the
 *     write deduped to one row). Exactly-once now rests on the unique index (create) +
 *     the naturally-idempotent last-writer-wins update + this guarded flip, NOT on a
 *     claim-before-write (no `target_version` gate exists yet — deferred to a41345b4).
 */
export async function applyProposal(
  sql: Sql,
  ctx: { tenantIds: string[]; approverUserId: string },
  proposalId: string,
  editedPayload?: Record<string, unknown> | null,
): Promise<AcceptResult> {
  const { approverUserId } = ctx

  // (1) LOAD (scoped).
  const proposal = await getProposalScoped(sql, proposalId, ctx.tenantIds)
  if (!proposal) return { status: 'not_found', proposal_id: proposalId }
  if (proposal.status !== 'pending') return { status: 'not_pending', proposal_id: proposalId }

  // (2) STRUCTURAL pre-checks — PERMANENT invariant failures this slice can never apply.
  // Terminally FAIL (guarded flip, no-op if already decided) so they don't sit in
  // `listPending` forever; no payload edit could rescue them.
  if (!SUPPORTED.has(`${proposal.target_type}:${proposal.operation}`)) {
    return failTerminal(sql, proposalId, `unsupported ${proposal.target_type}:${proposal.operation}`)
  }
  if (!proposal.run_id) return failTerminal(sql, proposalId, 'missing run_id (no attributable actor)')
  // Every non-create names a `uuid` target it acts on (work_item:update, memory:
  // supersede|retract|defer). Missing OR malformed (a slug that would `22P02`) is a
  // permanent structural defect — `isUuid(null)` is false, so this covers both.
  if (proposal.operation !== 'create' && !isUuid(proposal.target_id)) {
    return failTerminal(sql, proposalId, `${proposal.operation} proposal has a missing or malformed target_id`)
  }

  // The payload actually applied: this call's human edit → a previously-persisted edit/
  // snapshot → the agent's original. (Read from the LOADED row; the flip persists it.)
  const basePayload = (editedPayload ?? proposal.edited_payload ?? proposal.payload) as Record<string, unknown>

  // (3) ACCEPT-TIME VALIDATION + default-resolution (work_item only — the named
  // `22P02` class). `payloadToPersist` is the `$3` coalesced onto `edited_payload` at
  // the flip: the human edit when present, and — when we resolve a default team — the
  // SNAPSHOT with the resolved id (6055d30e), so a re-drive is deterministic.
  let effectivePayload = basePayload
  let payloadToPersist: string | null = editedPayload != null ? JSON.stringify(editedPayload) : null
  if (proposal.target_type === 'work_item') {
    try {
      const resolved = await validateAndResolveWorkItemPayload(
        sql,
        proposal.tenant_id,
        proposal.operation,
        basePayload,
      )
      effectivePayload = resolved.payload
      if (resolved.snapshot) payloadToPersist = JSON.stringify(resolved.payload)
    } catch (cause) {
      // A malformed/absent-but-ambiguous id is a FIXABLE decline — the proposal stays
      // `pending` (the human corrects the payload and re-accepts). Anything unexpected
      // is rethrown → route 500 (still pending, never applied).
      if (cause instanceof DomainError) {
        return { status: 'invalid', proposal_id: proposalId, message: cause.message, retryable: true }
      }
      throw cause
    }
  }

  // (3b) PRE-IMAGE (undo-on-accept) — for a `work_item:update` ONLY, read the
  // target's CURRENT values for the fields this patch will set, BEFORE the write
  // overwrites them. Persisted inside the existing `applied_write` jsonb at the
  // flip, this is what `POST /:id/undo` restores through the validated write path.
  // A read failure is NEVER allowed to fail the accept: applying the human's
  // decision matters more than the ability to reverse it, so a missing pre-image
  // simply leaves the accept un-undoable (the endpoint declines with a clear 422).
  let preImage: Record<string, unknown> | null = null
  let preImageFields: string[] = []
  if (proposal.target_type === 'work_item' && proposal.operation === 'update') {
    preImageFields = undoableKeys(effectivePayload)
    if (preImageFields.length > 0) {
      const beforeRows = (await sql`
        select * from work_items
        where id = ${proposal.target_id} and tenant_id = ${proposal.tenant_id}
      `) as Record<string, unknown>[]
      const before = beforeRows[0]
      if (before) preImage = fieldSnapshot(before, preImageFields)
    }
  }

  // Actor — the agent run acting on behalf of the approver.
  const actor: ActorContext = {
    actorType: 'agent',
    actorId: proposal.run_id,
    onBehalfOf: approverUserId,
    runId: proposal.run_id,
  }

  // (4) WRITE FIRST — the proposal is STILL `pending`, so a failure here leaves it
  // re-acceptable. On failure, classify WITHOUT touching the proposal.
  let result: WorkItemRow | MemoryRow
  try {
    if (proposal.target_type === 'memory') {
      result = await applyMemoryCommand(sql, proposal, effectivePayload, approverUserId)
    } else if (proposal.operation === 'create') {
      result = await createWorkItem(
        sql,
        { tenantId: proposal.tenant_id, actor, appliedFromProposalId: proposal.id },
        effectivePayload as CreateWorkItemInput,
      )
    } else {
      result = await updateWorkItem(
        sql,
        { tenantIds: [proposal.tenant_id], actor, expectedVersion: proposal.target_version ?? undefined },
        proposal.target_id as string,
        effectivePayload as UpdateWorkItemInput,
      )
    }
  } catch (cause) {
    return classifyWriteFailure(cause, proposal)
  }

  // (5) FLIP LAST — the single exactly-once winner-gate. ONE guarded statement stamps
  // the decision, the coalesced edited/snapshot payload ($3), and `applied_write` ($4).
  // Losing the `WHERE status='pending'` race → `not_pending` (a concurrent accept won;
  // our write was idempotent, so no double-row).
  // `applied_write` keeps its meaning — the row the write produced. When a
  // pre-image was captured it rides ALONGSIDE the row under a reserved key, so
  // every existing reader still finds the row's fields at the top level.
  const appliedWrite = preImage
    ? buildUndoEnvelope(
        result as unknown as Record<string, unknown>,
        preImage,
        fieldSnapshot(result as unknown as Record<string, unknown>, preImageFields),
      )
    : (result as unknown as Record<string, unknown>)

  const flipped = await sqlQuery<{ id: string }>(
    sql,
    `update proposals set status = 'applied', decided_by = $1, decided_at = now(),
       updated_at = now(), edited_payload = coalesce($3::jsonb, edited_payload),
       applied_write = $4::jsonb
     where id = $2 and status = 'pending' returning id`,
    [approverUserId, proposalId, payloadToPersist, JSON.stringify(appliedWrite)],
  )
  if (flipped.length === 0) {
    // We LOST the flip: the guarded UPDATE matched no `pending` row, so the proposal was
    // decided out from under us between our write (step 4) and this flip. Re-read to learn
    // WHO won and whether our just-written row must be compensated. (Cheap mitigation for
    // the flip-loser window; the full reject-fence — atomically blocking the write while a
    // decision is in flight — is carved to kernel 996b674c.)
    const current = await getProposalScoped(sql, proposalId, ctx.tenantIds)
    const decided = current?.status
    if (decided !== 'applied') {
      if (proposal.operation === 'create' && (decided === 'rejected' || decided === 'failed')) {
        // A human REJECT (or a terminal fail) won the race, but our accept-drive already
        // created a row. The human's decision must win — COMPENSATE by deleting it. The row
        // can ONLY have come from an accept-drive of THIS proposal (it is keyed on the
        // proposal id), so the delete is precisely scoped and cannot touch anything else.
        if (proposal.target_type === 'memory') {
          await sqlQuery(sql, `delete from memories where source_proposal_id = $1`, [proposalId])
        } else {
          await sqlQuery(sql, `delete from work_items where applied_from_proposal_id = $1`, [proposalId])
        }
      } else if (decided === 'rejected' || decided === 'failed') {
        // A non-create op (update/supersede/retract/defer) whose in-place mutation ALREADY
        // committed, then lost to a non-accept decision. There is no clean automatic undo,
        // so surface it LOUDLY for a human to reconcile rather than swallow it silently.
        // (Compensation for in-place writes is also carved to kernel 996b674c.)
        console.error(
          `[proposals] flip-loser needs manual reconciliation: proposal ${proposalId} was ` +
            `decided '${decided}' after a ${proposal.target_type}:${proposal.operation} write ` +
            `committed row ${result.id} — the write cannot be auto-undone`,
        )
      }
    }
    return { status: 'not_pending', proposal_id: proposalId }
  }
  return { status: 'applied', proposal_id: proposalId, item_id: result.id }
}
