import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { DomainError } from '../domain/errors'
import { acceptHttpStatus, applyProposal } from './apply'
import { UNDO_KEY } from './undo'

// The domain commands are the SHARED validated write path — here we mock them so
// each test controls exactly what the command does (returns a row / throws a typed
// DomainError) and can assert it ran. Under write-first/flip-last the exactly-once
// winner-gate is apply.ts's guarded FLIP (WHERE status='pending') + the create
// unique index, NOT a claim-before-write — so a racing accept may run the (idempotent)
// command more than once; only ONE flip wins. `resolveDefaultTeamId` is the 6055d30e
// sole-team resolver, mocked so accept-time resolution is deterministic here.
const { createWorkItem, updateWorkItem, resolveDefaultTeamId } = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  resolveDefaultTeamId: vi.fn(),
}))
vi.mock('../domain/work-items', () => ({ createWorkItem, updateWorkItem, resolveDefaultTeamId }))

// The memory domain is the SHARED validated write path for P1b, mocked the same way
// so each test controls the command outcome and asserts the agent actor + provenance.
const { createMemory, supersedeMemory, retractMemory, deferMemory, getMemoryBySourceProposalId } =
  vi.hoisted(() => ({
    createMemory: vi.fn(),
    supersedeMemory: vi.fn(),
    retractMemory: vi.fn(),
    deferMemory: vi.fn(),
    getMemoryBySourceProposalId: vi.fn(),
  }))
vi.mock('../domain/memories', () => ({
  createMemory,
  supersedeMemory,
  retractMemory,
  deferMemory,
  getMemoryBySourceProposalId,
}))

// Real UUIDs — accept-time validation now rejects any id that is not a well-formed
// UUID (a slug like 'team_1' would `22P02` against a uuid column), so fixtures use
// canonical ids that pass the guard and reach the (mocked) command.
const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const STATUS_ID = '22222222-2222-4222-8222-222222222222'
const WI_TARGET = '44444444-4444-4444-8444-444444444444'
const MEM_TARGET = '33333333-3333-4333-8333-333333333333'
const FOREIGN_MEM = '55555555-5555-4555-8555-555555555555'

const MEM_ROW = {
  id: 'mem_new',
  tenant_id: 't_1',
  kind: 'decision',
  title: 'Use Postgres',
  body: 'x',
  status: 'active',
  source_kind: 'proposal',
  source_proposal_id: 'p1',
  source_run_id: 'run_1',
}

const WI_ROW = {
  id: 'wi_new',
  title: 'A',
  team_id: TEAM_ID,
  status_id: STATUS_ID,
  parent_id: null,
  depth: 0,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

const CREATE_PROPOSAL = {
  id: 'p1',
  tenant_id: 't_1',
  run_id: 'run_1',
  target_type: 'work_item',
  target_id: null,
  operation: 'create',
  payload: { title: 'A', team_id: TEAM_ID, status_id: STATUS_ID, department: 'Eng' },
  edited_payload: null,
  target_version: null,
  status: 'pending' as string,
}

/**
 * A stateful `sql` mock. The FLIP `UPDATE … WHERE status='pending'` (write-first/
 * flip-last) returns a row only while the (closure-held) status is pending, and flips
 * it to `applied` — this is the single exactly-once winner-gate. `failInvalid` flips to
 * `failed`. Under the reorder there is NO revert-from-applied (a failed write never
 * flipped), so those branches never run. `getStatus()` exposes the final lifecycle
 * state. Tagged templates (getProposalScoped) go through `sql(...)`; the parameterized
 * proposal mutations go through `sql.query(text, params)`.
 */
function makeSql(
  opts: {
    proposal?: Record<string, unknown>
    /** The target work item as it stands BEFORE the write — the pre-image source. */
    targetRow?: Record<string, unknown> | null
  } = {},
) {
  const proposal = { ...CREATE_PROPOSAL, ...(opts.proposal ?? {}) }
  let status = proposal.status as string

  const query = vi.fn(async (text: string, params: unknown[]) => {
    if (text.includes("set status = 'applied'")) {
      if (status === 'pending') {
        status = 'applied'
        // Mirror the atomic flip's `edited_payload = coalesce($3::jsonb, edited_payload)`:
        // `returning` reflects the persisted payload when the accept bound one ($3).
        const editedJson = params[2]
        const edited_payload =
          editedJson != null ? JSON.parse(editedJson as string) : proposal.edited_payload
        return [{ ...proposal, status: 'applied', edited_payload }]
      }
      return []
    }
    if (text.includes("set status = 'failed'")) {
      status = 'failed'
      return []
    }
    return []
  })

  const sql = vi.fn(async (strings: TemplateStringsArray, ..._params: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings)
    if (text.includes('from proposals')) return [{ ...proposal, status }]
    // The pre-image read (undo-on-accept): the target's CURRENT values, captured
    // BEFORE the update writes over them.
    if (text.includes('from work_items')) return opts.targetRow ? [opts.targetRow] : []
    return []
  }) as unknown as Sql
  ;(sql as unknown as { query: typeof query }).query = query

  return { sql, getStatus: () => status, query }
}

const ctx = { tenantIds: ['t_1'], approverUserId: 'u_approver' }

describe('applyProposal (write-first, flip-last)', () => {
  beforeEach(() => {
    createWorkItem.mockReset().mockResolvedValue(WI_ROW)
    updateWorkItem.mockReset().mockResolvedValue(WI_ROW)
    resolveDefaultTeamId.mockReset().mockResolvedValue(TEAM_ID)
    createMemory.mockReset().mockResolvedValue(MEM_ROW)
    supersedeMemory.mockReset().mockResolvedValue(MEM_ROW)
    retractMemory.mockReset().mockResolvedValue(MEM_ROW)
    deferMemory.mockReset().mockResolvedValue(MEM_ROW)
    getMemoryBySourceProposalId.mockReset().mockResolvedValue(null)
  })

  it('applies a pending create through the domain command as an agent on-behalf-of the approver', async () => {
    const { sql, getStatus } = makeSql({})
    const res = await applyProposal(sql, ctx, 'p1')
    // The stable envelope: applied + the resulting item id (not the full row).
    expect(res).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'wi_new' })
    expect(getStatus()).toBe('applied')
    expect(createWorkItem).toHaveBeenCalledTimes(1)
    // The write is stamped as the run acting on behalf of the approver, and carries
    // the proposal id for idempotent re-drive.
    const [, cmdCtx] = createWorkItem.mock.calls[0] ?? []
    expect(cmdCtx).toMatchObject({
      tenantId: 't_1',
      appliedFromProposalId: 'p1',
      actor: { actorType: 'agent', actorId: 'run_1', onBehalfOf: 'u_approver', runId: 'run_1' },
    })
  })

  it('flips to applied only AFTER the write succeeds (the flip carries the exactly-once guard)', async () => {
    const { sql, query } = makeSql({})
    let flippedWhileWriting = false
    createWorkItem.mockReset().mockImplementation(async () => {
      // At the moment the command runs, no flip may have happened yet.
      const flips = (query.mock.calls as [string, unknown[]][]).filter(([t]) =>
        t.includes("set status = 'applied'"),
      )
      flippedWhileWriting = flips.length > 0
      return WI_ROW
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res.status).toBe('applied')
    expect(flippedWhileWriting).toBe(false)
    // The flip is the winner-gate: its UPDATE must carry `status = 'pending'`.
    const flip = (query.mock.calls as [string, unknown[]][]).find(([t]) =>
      t.includes("set status = 'applied'"),
    )
    expect(flip?.[0]).toContain("status = 'pending'")
    // It also records the applied write atomically in the SAME statement ($4).
    expect(flip?.[0]).toContain('applied_write')
  })

  it('two concurrent accepts: exactly one applies, the other is not_pending (guarded flip)', async () => {
    const { sql, query } = makeSql({})
    const [a, b] = await Promise.all([applyProposal(sql, ctx, 'p1'), applyProposal(sql, ctx, 'p1')])
    const applied = [a, b].filter((r) => r.status === 'applied')
    const rejected = [a, b].filter((r) => r.status !== 'applied')
    expect(applied).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toEqual({ status: 'not_pending', proposal_id: 'p1' })
    // The gate is the SQL itself, not the command: every FLIP UPDATE must carry the
    // exactly-once guard `status = 'pending'`. Assert on the real SQL text so deleting
    // the guard from apply.ts would fail here (the command mock alone wouldn't).
    const flipCalls = (query.mock.calls as [string, unknown[]][]).filter(([t]) =>
      t.includes("set status = 'applied'"),
    )
    expect(flipCalls.length).toBeGreaterThanOrEqual(1)
    for (const [text] of flipCalls) {
      expect(text).toContain("status = 'pending'")
    }
  })

  it('a second accept of an already-applied proposal is a no-op (not_pending)', async () => {
    const { sql } = makeSql({})
    const first = await applyProposal(sql, ctx, 'p1')
    expect(first.status).toBe('applied')
    const second = await applyProposal(sql, ctx, 'p1')
    expect(second).toEqual({ status: 'not_pending', proposal_id: 'p1' })
    expect(createWorkItem).toHaveBeenCalledTimes(1)
  })

  it('6055d30e: create with team_id OMITTED resolves the sole team and SNAPSHOTS it', async () => {
    resolveDefaultTeamId.mockReset().mockResolvedValue(TEAM_ID)
    const { sql, query } = makeSql({
      proposal: { payload: { title: 'A', status_id: STATUS_ID, department: 'Eng' } },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'wi_new' })
    expect(resolveDefaultTeamId).toHaveBeenCalledWith(sql, 't_1')
    // The resolved id reached the domain command (deterministic write)...
    const [, , input] = createWorkItem.mock.calls[0] ?? []
    expect(input).toMatchObject({ team_id: TEAM_ID })
    // ...AND was snapshotted into edited_payload at the flip ($3), so a re-drive after a
    // 2nd team is added still uses THIS id (no `team_required_multiple`).
    const flip = (query.mock.calls as [string, unknown[]][]).find(([t]) =>
      t.includes("set status = 'applied'"),
    )
    expect(flip?.[0]).toContain('edited_payload = coalesce($3::jsonb, edited_payload)')
    expect(JSON.parse(flip?.[1]?.[2] as string)).toMatchObject({ team_id: TEAM_ID })
  })

  it('accept-time validation: a malformed team_id is a clean invalid (field-scoped), proposal stays pending, no write', async () => {
    const { sql, getStatus, query } = makeSql({
      proposal: { payload: { title: 'A', team_id: 'not-a-uuid', status_id: STATUS_ID } },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    // Recoverable decline → invalid + retryable:true; the Inbox offers Retry/Edit.
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: true })
    // The plain-language reason names the offending field.
    if (res.status === 'invalid') expect(res.message).toContain('team_id')
    // Fixable field error → recoverable: never claimed, never written, never flipped.
    expect(getStatus()).toBe('pending')
    expect(createWorkItem).not.toHaveBeenCalled()
    const flips = (query.mock.calls as [string, unknown[]][]).filter(([t]) =>
      t.includes("set status = 'applied'"),
    )
    expect(flips).toHaveLength(0)
  })

  it('accept-time resolution: ambiguous default team (multiple teams) → invalid, stays pending', async () => {
    resolveDefaultTeamId
      .mockReset()
      .mockRejectedValue(new DomainError('team_required_multiple', 'multiple teams — specify team_id'))
    const { sql, getStatus } = makeSql({
      proposal: { payload: { title: 'A', status_id: STATUS_ID, department: 'Eng' } },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: true })
    if (res.status === 'invalid') expect(res.message).toContain('team')
    expect(getStatus()).toBe('pending')
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('write fails (unknown_team) → NOT flipped: proposal stays pending, recoverable invalid', async () => {
    createWorkItem.mockReset().mockRejectedValue(new DomainError('unknown_team', 'Unknown team'))
    const { sql, getStatus, query } = makeSql({})
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: true })
    if (res.status === 'invalid') expect(res.message).toBe('Unknown team')
    // The write ran BEFORE any flip, so the failed proposal is still pending (re-acceptable).
    expect(getStatus()).toBe('pending')
    expect(createWorkItem).toHaveBeenCalledTimes(1)
    const flips = (query.mock.calls as [string, unknown[]][]).filter(([t]) =>
      t.includes("set status = 'applied'"),
    )
    expect(flips).toHaveLength(0)
  })

  it('retryable distinguishes a RECOVERABLE invalid (stays pending) from a TERMINAL one (failed in DB)', async () => {
    // Recoverable: a fixable payload id — invalid + retryable:true, proposal stays pending.
    const recoverable = makeSql({
      proposal: { payload: { title: 'A', team_id: 'not-a-uuid', status_id: STATUS_ID } },
    })
    const rec = await applyProposal(recoverable.sql, ctx, 'p1')
    expect(rec).toMatchObject({ status: 'invalid', retryable: true })
    expect(recoverable.getStatus()).toBe('pending')

    // Terminal: a structural defect no edit can fix — invalid + retryable:false, DB → failed.
    const terminal = makeSql({ proposal: { run_id: null } })
    const term = await applyProposal(terminal.sql, ctx, 'p1')
    expect(term).toMatchObject({ status: 'invalid', retryable: false })
    expect(terminal.getStatus()).toBe('failed')
  })

  it('write fails (raw pg 22P02) → classified as invalid (not a 500), proposal stays pending', async () => {
    const pgErr = Object.assign(new Error('invalid input syntax for type uuid: "open"'), { code: '22P02' })
    createWorkItem.mockReset().mockRejectedValue(pgErr)
    const { sql, getStatus } = makeSql({})
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: true })
    expect(getStatus()).toBe('pending')
  })

  it('an unexpected (non-data) write error is rethrown → route 500, proposal stays pending', async () => {
    createWorkItem.mockReset().mockRejectedValue(new Error('connection reset'))
    const { sql, getStatus } = makeSql({})
    await expect(applyProposal(sql, ctx, 'p1')).rejects.toThrow('connection reset')
    expect(getStatus()).toBe('pending')
  })

  it('stale: the update command throws DomainError(stale) → stale envelope, proposal stays pending', async () => {
    updateWorkItem.mockReset().mockRejectedValue(new DomainError('stale', 'target changed'))
    const { sql, getStatus } = makeSql({
      proposal: { operation: 'update', target_id: WI_TARGET, target_version: 3, payload: { phase: 'done' } },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    // The stale envelope carries the moved item + a plain-language reason.
    expect(res).toEqual({ status: 'stale', proposal_id: 'p1', item_id: WI_TARGET, message: 'target changed' })
    expect(getStatus()).toBe('pending') // never flipped → still reviewable
    expect(updateWorkItem).toHaveBeenCalledTimes(1)
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('returns not_found for a proposal outside the caller tenants (no write)', async () => {
    const sql = vi.fn(async () => []) as unknown as Sql // getProposalScoped → null
    const res = await applyProposal(sql, ctx, 'p_ghost')
    expect(res).toEqual({ status: 'not_found', proposal_id: 'p_ghost' })
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('returns terminal invalid for an unsupported target/operation AND fails it in the DB (never written)', async () => {
    const { sql, getStatus } = makeSql({ proposal: { target_type: 'invoice', operation: 'create' } })
    const res = await applyProposal(sql, ctx, 'p1')
    // A permanent structural defect → invalid + retryable:false (Discard only); it can't
    // sit pending in listPending forever, and the command never runs.
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: false })
    expect(getStatus()).toBe('failed')
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('a proposal with null run_id terminally fails; a second accept is not_pending', async () => {
    const { sql, getStatus } = makeSql({ proposal: { run_id: null } })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: false })
    expect(getStatus()).toBe('failed') // no longer pending → out of listPending
    expect(createWorkItem).not.toHaveBeenCalled()
    // The proposal is now terminal: re-accepting it is a no-op, not a perpetual error.
    const second = await applyProposal(sql, ctx, 'p1')
    expect(second).toEqual({ status: 'not_pending', proposal_id: 'p1' })
  })

  it('a non-create with a malformed target_id terminally fails (no 22P02 500)', async () => {
    const { sql, getStatus } = makeSql({
      proposal: { operation: 'update', target_id: 'not-a-uuid', payload: { phase: 'done' } },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: false })
    if (res.status === 'invalid') expect(res.message).toContain('target_id')
    expect(getStatus()).toBe('failed')
    expect(updateWorkItem).not.toHaveBeenCalled()
  })

  const MEMORY_CREATE = {
    target_type: 'memory',
    target_id: null,
    operation: 'create',
    payload: { kind: 'decision', title: 'Use Postgres', body: 'x', topics: ['db'] },
  }

  it('applies a memory:create through the memory domain with the agent actor + proposal provenance', async () => {
    const { sql, getStatus } = makeSql({ proposal: MEMORY_CREATE })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'mem_new' })
    expect(getStatus()).toBe('applied')
    expect(createWorkItem).not.toHaveBeenCalled()
    expect(createMemory).toHaveBeenCalledTimes(1)
    const [, cmdCtx, input] = createMemory.mock.calls[0] ?? []
    // created_by = the RUN (the agent), decided by the approver, stamped with the
    // proposal + run provenance so a proposal-applied memory is fully accountable.
    expect(cmdCtx).toEqual({ tenantId: 't_1', actor: 'run_1' })
    expect(input).toMatchObject({
      kind: 'decision',
      title: 'Use Postgres',
      body: 'x',
      topics: ['db'],
      sourceKind: 'proposal',
      sourceRunId: 'run_1',
      sourceProposalId: 'p1',
      decidedBy: 'u_approver',
    })
  })

  it('applies a rule create proposal with attrs + enforcement + pinned, forwarding them to createMemory', async () => {
    // createMemory is mocked in this file (the domain command is exercised directly
    // in memories.test.ts) — so the assertion that matters here is what apply.ts
    // FORWARDS to it: the zod payload schema must not strip attrs/enforcement/pinned.
    const { sql, getStatus } = makeSql({
      proposal: {
        target_type: 'memory',
        target_id: null,
        operation: 'create',
        payload: {
          kind: 'rule',
          title: 'Prefer concise titles',
          attrs: { applies_when: 'project Foo', evidence_proposal_ids: ['p_1', 'p_2'] },
          enforcement: 'hard',
          pinned: true,
        },
      },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'mem_new' })
    expect(getStatus()).toBe('applied')
    expect(createMemory).toHaveBeenCalledTimes(1)
    const [, , input] = createMemory.mock.calls[0] ?? []
    expect(input).toMatchObject({
      kind: 'rule',
      title: 'Prefer concise titles',
      attrs: { applies_when: 'project Foo', evidence_proposal_ids: ['p_1', 'p_2'] },
      enforcement: 'hard',
      pinned: true,
    })
  })

  it('persists the human-edited payload at the flip and applies IT (per-rule strength: advisory → hard + pinned)', async () => {
    // The reviewer downgraded/upgraded a rule proposal in the Inbox: the original
    // agent payload is advisory + unpinned; the human edit forces enforcement 'hard'
    // and pins it. The atomic flip must persist `edited_payload` ($3, coalesced) so
    // apply's `edited_payload ?? payload` applies the MERGED payload, not the original.
    const { sql, getStatus, query } = makeSql({
      proposal: {
        target_type: 'memory',
        target_id: null,
        operation: 'create',
        payload: {
          kind: 'rule',
          title: 'Prefer concise titles',
          attrs: { applies_when: 'project Foo', evidence_proposal_ids: ['p_1', 'p_2'] },
          enforcement: 'advisory',
          pinned: false,
        },
      },
    })
    const editedPayload = {
      kind: 'rule',
      title: 'Prefer concise titles',
      attrs: { applies_when: 'project Foo', evidence_proposal_ids: ['p_1', 'p_2'] },
      enforcement: 'hard',
      pinned: true,
    }
    const res = await applyProposal(sql, ctx, 'p1', editedPayload)
    expect(res).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'mem_new' })
    expect(getStatus()).toBe('applied')
    // The MERGED payload reached the domain command — strength stuck.
    expect(createMemory).toHaveBeenCalledTimes(1)
    const [, , input] = createMemory.mock.calls[0] ?? []
    expect(input).toMatchObject({ enforcement: 'hard', pinned: true })
    // The flip statement itself persists the edit atomically: it coalesces onto
    // `edited_payload` and binds the serialized edit as $3 (not a separate pre-write).
    const flip = (query.mock.calls as [string, unknown[]][]).find(([t]) =>
      t.includes("set status = 'applied'"),
    )
    expect(flip?.[0]).toContain('edited_payload = coalesce($3::jsonb, edited_payload)')
    expect(flip?.[1]?.[2]).toBe(JSON.stringify(editedPayload))
  })

  it('accept with NO editedPayload leaves edited_payload untouched (backward compatible; binds null $3)', async () => {
    const { sql, query } = makeSql({ proposal: MEMORY_CREATE })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res.status).toBe('applied')
    const flip = (query.mock.calls as [string, unknown[]][]).find(([t]) =>
      t.includes("set status = 'applied'"),
    )
    // Coalesce keeps the existing value when the 3rd bind is null.
    expect(flip?.[1]?.[2]).toBeNull()
  })

  it('memory:create is IDEMPOTENT — a re-drive with an existing source_proposal_id returns it, no double-create', async () => {
    const existing = { ...MEM_ROW, id: 'mem_existing' }
    getMemoryBySourceProposalId.mockResolvedValue(existing)
    const { sql } = makeSql({ proposal: MEMORY_CREATE })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'mem_existing' })
    // The guard fired: the domain create never ran (no second memory row).
    expect(createMemory).not.toHaveBeenCalled()
    // The lookup is tenant-scoped to the proposal's own org (the apply is the boundary).
    expect(getMemoryBySourceProposalId).toHaveBeenCalledWith(sql, 'p1', ['t_1'])
  })

  it('dispatches memory:supersede to the domain with target + agent source provenance', async () => {
    const { sql } = makeSql({
      proposal: {
        target_type: 'memory',
        operation: 'supersede',
        target_id: MEM_TARGET,
        payload: { body: 'Reversed', change_reason: 'Mongo chosen' },
      },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'mem_new' })
    expect(supersedeMemory).toHaveBeenCalledTimes(1)
    const [, cmdCtx, targetId, input] = supersedeMemory.mock.calls[0] ?? []
    // Tenant isolation: the command is scoped to the proposal's OWN tenant, so a
    // foreign target id can never be superseded here (the domain returns not_found).
    expect(cmdCtx).toEqual({ tenantIds: ['t_1'], actor: 'run_1' })
    expect(targetId).toBe(MEM_TARGET)
    expect(input).toMatchObject({
      body: 'Reversed',
      changeReason: 'Mongo chosen',
      sourceKind: 'proposal',
      sourceRunId: 'run_1',
      sourceProposalId: 'p1',
      // The new version records the approver, not the old row's decider.
      decidedBy: 'u_approver',
    })
  })

  it('dispatches memory:retract and memory:defer to the domain (agent actor, proposal tenant)', async () => {
    const retractSql = makeSql({
      proposal: { target_type: 'memory', operation: 'retract', target_id: MEM_TARGET, payload: {} },
    })
    expect(await applyProposal(retractSql.sql, ctx, 'p1')).toEqual({
      status: 'applied',
      proposal_id: 'p1',
      item_id: 'mem_new',
    })
    expect(retractMemory).toHaveBeenCalledWith(retractSql.sql, { tenantIds: ['t_1'], actor: 'run_1' }, MEM_TARGET)

    const deferSql = makeSql({
      proposal: {
        target_type: 'memory',
        operation: 'defer',
        target_id: MEM_TARGET,
        payload: { waiting_on: 'legal', review_after: '2026-08-01' },
      },
    })
    expect(await applyProposal(deferSql.sql, ctx, 'p1')).toEqual({
      status: 'applied',
      proposal_id: 'p1',
      item_id: 'mem_new',
    })
    const [, , deferTarget, deferInput] = deferMemory.mock.calls[0] ?? []
    expect(deferTarget).toBe(MEM_TARGET)
    expect(deferInput).toMatchObject({ waitingOn: 'legal', reviewAfter: '2026-08-01' })
  })

  it('memory supersede DomainError(conflict) → stale envelope, proposal stays pending (reviewable)', async () => {
    supersedeMemory.mockReset().mockRejectedValue(new DomainError('conflict', 'no longer active'))
    const { sql, getStatus } = makeSql({
      proposal: {
        target_type: 'memory',
        operation: 'supersede',
        target_id: MEM_TARGET,
        payload: { change_reason: 'x' },
      },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'stale', proposal_id: 'p1', item_id: MEM_TARGET })
    expect(getStatus()).toBe('pending') // still reviewable, like a stale work-item update
  })

  it('memory supersede DomainError(not_found) on a foreign/vanished target → invalid, stays pending', async () => {
    supersedeMemory.mockReset().mockRejectedValue(new DomainError('not_found', 'Not found'))
    const { sql, getStatus } = makeSql({
      proposal: {
        target_type: 'memory',
        operation: 'supersede',
        target_id: FOREIGN_MEM,
        payload: { change_reason: 'x' },
      },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: true })
    // The write ran before any flip, so the proposal is still pending (the human can discard it).
    expect(getStatus()).toBe('pending')
  })

  it('terminally fails an unsupported memory operation (never written)', async () => {
    const { sql, getStatus } = makeSql({
      proposal: { target_type: 'memory', operation: 'frobnicate', target_id: MEM_TARGET, payload: {} },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toMatchObject({ status: 'invalid', proposal_id: 'p1', retryable: false })
    expect(getStatus()).toBe('failed')
    expect(supersedeMemory).not.toHaveBeenCalled()
  })
})

/**
 * UNDO-ON-ACCEPT pre-image capture. Accepting a `work_item:update` records the
 * target's values BEFORE the write inside the EXISTING `applied_write` jsonb (no
 * new column, no migration), so the accept can later be reversed through the
 * validated write path. Every other operation is unaffected.
 */
describe('applyProposal — pre-image capture (undo-on-accept)', () => {
  const TARGET_BEFORE = {
    id: WI_TARGET,
    title: 'Before',
    priority: 'low',
    department: 'Eng',
    due_date: new Date('2026-07-01T00:00:00.000Z'),
  }
  const UPDATE_PROPOSAL = {
    id: 'p1',
    tenant_id: 't_1',
    run_id: 'run_1',
    target_type: 'work_item',
    target_id: WI_TARGET,
    operation: 'update',
    payload: { title: 'After', priority: 'high' },
    edited_payload: null,
    target_version: null,
    status: 'pending' as string,
  }
  const AFTER_ROW = { ...WI_ROW, id: WI_TARGET, title: 'After', priority: 'high' }

  /** The `applied_write` jsonb the flip bound as `$4`. */
  function flippedAppliedWrite(query: { mock: { calls: [string, unknown[]][] } }) {
    const flip = query.mock.calls.find(([t]) => t.includes("set status = 'applied'"))
    return JSON.parse(flip?.[1]?.[3] as string) as Record<string, unknown>
  }

  beforeEach(() => {
    updateWorkItem.mockReset().mockResolvedValue(AFTER_ROW)
  })

  it('stores the target’s PRE-write values for exactly the fields the patch sets', async () => {
    const { sql, query } = makeSql({ proposal: UPDATE_PROPOSAL, targetRow: TARGET_BEFORE })
    expect((await applyProposal(sql, ctx, 'p1')).status).toBe('applied')

    const appliedWrite = flippedAppliedWrite(query)
    expect(appliedWrite[UNDO_KEY]).toEqual({
      pre_image: { title: 'Before', priority: 'low' },
      // What the accept applied — the 409 conflict check compares against THIS.
      applied: { title: 'After', priority: 'high' },
    })
  })

  it('keeps the applied ROW at the top level (existing applied_write readers unaffected)', async () => {
    const { sql, query } = makeSql({ proposal: UPDATE_PROPOSAL, targetRow: TARGET_BEFORE })
    await applyProposal(sql, ctx, 'p1')
    expect(flippedAppliedWrite(query)).toMatchObject({ id: WI_TARGET, title: 'After' })
  })

  it('reads the pre-image BEFORE the domain command overwrites it', async () => {
    const { sql } = makeSql({ proposal: UPDATE_PROPOSAL, targetRow: TARGET_BEFORE })
    let readBeforeWrite = false
    updateWorkItem.mockReset().mockImplementation(async () => {
      readBeforeWrite = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
        (call) => Array.isArray(call[0]) && (call[0] as string[]).join('?').includes('from work_items'),
      )
      return AFTER_ROW
    })
    await applyProposal(sql, ctx, 'p1')
    expect(readBeforeWrite).toBe(true)
  })

  it('captures a `null` pre-image value for a field the target had unset', async () => {
    const { sql, query } = makeSql({
      proposal: { ...UPDATE_PROPOSAL, payload: { assignee_id: 'u_1' } },
      targetRow: { id: WI_TARGET },
    })
    await applyProposal(sql, ctx, 'p1')
    const envelope = flippedAppliedWrite(query)[UNDO_KEY] as { pre_image: Record<string, unknown> }
    expect(envelope.pre_image).toEqual({ assignee_id: null })
  })

  it('ignores payload keys that are not restorable columns', async () => {
    const { sql, query } = makeSql({
      proposal: { ...UPDATE_PROPOSAL, payload: { title: 'After', not_a_column: 1 } },
      targetRow: TARGET_BEFORE,
    })
    await applyProposal(sql, ctx, 'p1')
    const envelope = flippedAppliedWrite(query)[UNDO_KEY] as { pre_image: Record<string, unknown> }
    expect(envelope.pre_image).toEqual({ title: 'Before' })
  })

  it('records NO pre-image when the target row could not be read (undo stays refused)', async () => {
    const { sql, query } = makeSql({ proposal: UPDATE_PROPOSAL, targetRow: null })
    expect((await applyProposal(sql, ctx, 'p1')).status).toBe('applied')
    expect(flippedAppliedWrite(query)[UNDO_KEY]).toBeUndefined()
  })

  it('leaves a CREATE’s applied_write as the bare row (undoing a create is out of scope)', async () => {
    const { sql, query } = makeSql({})
    await applyProposal(sql, ctx, 'p1')
    const appliedWrite = flippedAppliedWrite(query)
    expect(appliedWrite[UNDO_KEY]).toBeUndefined()
    expect(appliedWrite).toMatchObject({ id: 'wi_new' })
  })

  it('leaves a MEMORY supersede’s applied_write as the bare row', async () => {
    const { sql, query } = makeSql({
      proposal: {
        ...UPDATE_PROPOSAL,
        target_type: 'memory',
        target_id: MEM_TARGET,
        operation: 'supersede',
        payload: { title: 'x' },
      },
    })
    await applyProposal(sql, ctx, 'p1')
    expect(flippedAppliedWrite(query)[UNDO_KEY]).toBeUndefined()
  })
})

describe('acceptHttpStatus', () => {
  it('splits `failed` on retryable: transient → 500 (alerts), deterministic → 422 (not a 5xx)', () => {
    expect(acceptHttpStatus({ status: 'failed', proposal_id: 'p1', message: 'x', retryable: true })).toBe(500)
    expect(acceptHttpStatus({ status: 'failed', proposal_id: 'p1', message: 'x', retryable: false })).toBe(422)
  })

  it('maps the decision + guard variants to their fixed statuses', () => {
    expect(acceptHttpStatus({ status: 'applied', proposal_id: 'p1', item_id: 'w' })).toBe(200)
    expect(acceptHttpStatus({ status: 'invalid', proposal_id: 'p1', message: 'x', retryable: true })).toBe(422)
    expect(acceptHttpStatus({ status: 'invalid', proposal_id: 'p1', message: 'x', retryable: false })).toBe(422)
    expect(acceptHttpStatus({ status: 'stale', proposal_id: 'p1', item_id: 'w', message: 'x' })).toBe(409)
    expect(acceptHttpStatus({ status: 'not_found', proposal_id: 'p1' })).toBe(404)
    expect(acceptHttpStatus({ status: 'not_pending', proposal_id: 'p1' })).toBe(409)
  })
})

/**
 * CAPTURE-ON-ACCEPT. Accepting a work-item proposal leaves behind the decision it
 * represents, so the loop compounds from ordinary accepted work rather than only
 * from proposals that were themselves memories.
 */
describe('applyProposal — capture-on-accept', () => {
  beforeEach(() => {
    createWorkItem.mockReset().mockResolvedValue(WI_ROW)
    createMemory.mockReset().mockResolvedValue(MEM_ROW)
  })

  it('captures a DECISION memory when the accept carries a rationale', async () => {
    const { sql } = makeSql({
      proposal: { rationale: 'Ship the smaller surface first.' },
    })

    const res = await applyProposal(sql, ctx, 'p1')

    expect(res.status).toBe('applied')
    expect(createMemory).toHaveBeenCalledTimes(1)
    const [, memCtx, input] = createMemory.mock.calls[0] ?? []
    expect(input.kind).toBe('decision')
    expect(input.sourceProposalId).toBe('p1')
    // The run authored it; a HUMAN decided it. Provenance keeps those separate.
    expect(memCtx.actor).toBe('run_1')
    expect(input.decidedBy).toBe('u_approver')
  })

  it('does NOT capture a bare accept — no rationale, no edit', async () => {
    // Such a memory would only restate the proposals row, which is the landfill
    // that makes a memory store useless later.
    const { sql } = makeSql({})

    const res = await applyProposal(sql, ctx, 'p1')

    expect(res.status).toBe('applied')
    expect(createMemory).not.toHaveBeenCalled()
  })

  it('still reports the accept as APPLIED when capture fails', async () => {
    // Memory is enrichment, not the write. An accept that already committed must
    // never be reported as failed because a secondary record could not be stored.
    createMemory.mockRejectedValueOnce(new Error('memory store unavailable'))
    const { sql, getStatus } = makeSql({
      proposal: { rationale: 'Ship the smaller surface first.' },
    })

    const res = await applyProposal(sql, ctx, 'p1')

    expect(res.status).toBe('applied')
    expect(getStatus()).toBe('applied')
  })
})
