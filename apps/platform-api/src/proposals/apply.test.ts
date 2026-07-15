import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { DomainError } from '../domain/errors'
import { applyProposal } from './apply'

// The domain commands are the SHARED validated write path — here we mock them so
// each test controls exactly what the command does (returns a row / throws a typed
// DomainError) and can assert it ran the right number of times. The exactly-once
// guarantee under test lives in apply.ts's CLAIM, not in the command.
const { createWorkItem, updateWorkItem } = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
}))
vi.mock('../domain/work-items', () => ({ createWorkItem, updateWorkItem }))

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
  team_id: 'team_1',
  status_id: 'status_1',
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
  payload: { title: 'A', team_id: 'team_1', status_id: 'status_1', department: 'Eng' },
  edited_payload: null,
  target_version: null,
  status: 'pending' as string,
}

/**
 * A stateful `sql` mock that enforces the ONE invariant the exactly-once gate
 * depends on: the CLAIM `UPDATE … WHERE status='pending'` returns a row only while
 * the (closure-held) status is pending, and flips it. The compensations flip it
 * back to `pending` / `failed`. `getStatus()` exposes the final lifecycle state.
 * Tagged templates (getProposalScoped) go through `sql(...)`; the parameterized
 * proposal mutations go through `sql.query(text, params)`.
 */
function makeSql(opts: { proposal?: Record<string, unknown> } = {}) {
  const proposal = { ...CREATE_PROPOSAL, ...(opts.proposal ?? {}) }
  let status = proposal.status as string

  const query = vi.fn(async (text: string, _params: unknown[]) => {
    if (text.includes("set status = 'applied'")) {
      if (status === 'pending') {
        status = 'applied'
        return [{ ...proposal, status: 'applied' }]
      }
      return []
    }
    if (text.includes('set applied_write')) return []
    if (text.includes("set status = 'pending'")) {
      status = 'pending'
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
    return []
  }) as unknown as Sql
  ;(sql as unknown as { query: typeof query }).query = query

  return { sql, getStatus: () => status, query }
}

const ctx = { tenantIds: ['t_1'], approverUserId: 'u_approver' }

describe('applyProposal (Design C: claim-then-command)', () => {
  beforeEach(() => {
    createWorkItem.mockReset().mockResolvedValue(WI_ROW)
    updateWorkItem.mockReset().mockResolvedValue(WI_ROW)
    createMemory.mockReset().mockResolvedValue(MEM_ROW)
    supersedeMemory.mockReset().mockResolvedValue(MEM_ROW)
    retractMemory.mockReset().mockResolvedValue(MEM_ROW)
    deferMemory.mockReset().mockResolvedValue(MEM_ROW)
    getMemoryBySourceProposalId.mockReset().mockResolvedValue(null)
  })

  it('applies a pending create through the domain command as an agent on-behalf-of the approver', async () => {
    const { sql, getStatus } = makeSql({})
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: true, result: WI_ROW })
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

  it('(a) two concurrent accepts race: exactly one applies, the domain command runs once', async () => {
    const { sql, query } = makeSql({})
    const [a, b] = await Promise.all([applyProposal(sql, ctx, 'p1'), applyProposal(sql, ctx, 'p1')])
    const applied = [a, b].filter((r) => r.applied)
    const rejected = [a, b].filter((r) => !r.applied)
    expect(applied).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toEqual({ applied: false, reason: 'not_pending' })
    // The claim gate let exactly one winner reach the command.
    expect(createWorkItem).toHaveBeenCalledTimes(1)
    // The gate is the SQL itself, not this mock: the CLAIM UPDATE must carry the
    // exactly-once guard `status = 'pending'`. Assert on the real SQL text so that
    // deleting the guard from apply.ts would fail here (the mock alone wouldn't).
    const claimCalls = (query.mock.calls as [string, unknown[]][]).filter(([t]) =>
      t.includes("set status = 'applied'"),
    )
    expect(claimCalls.length).toBeGreaterThanOrEqual(1)
    for (const [text] of claimCalls) {
      expect(text).toContain("status = 'pending'")
    }
  })

  it('(b) a second accept of an already-applied proposal is a no-op (not_pending)', async () => {
    const { sql } = makeSql({})
    const first = await applyProposal(sql, ctx, 'p1')
    expect(first.applied).toBe(true)
    const second = await applyProposal(sql, ctx, 'p1')
    expect(second).toEqual({ applied: false, reason: 'not_pending' })
    expect(createWorkItem).toHaveBeenCalledTimes(1)
  })

  it('(c) stale: the update command throws DomainError(stale) → proposal reverts to pending', async () => {
    updateWorkItem.mockReset().mockRejectedValue(new DomainError('stale', 'target changed'))
    const { sql, getStatus, query } = makeSql({
      proposal: { operation: 'update', target_id: 'wi_1', payload: { phase: 'done' } },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'stale' })
    expect(getStatus()).toBe('pending') // reverted → still reviewable
    expect(updateWorkItem).toHaveBeenCalledTimes(1)
    expect(createWorkItem).not.toHaveBeenCalled()
    // The revert must be GUARDED to the row THIS call claimed: it only touches an
    // `applied` row whose `decided_by` is this approver (never another accept's row).
    const revert = (query.mock.calls as [string, unknown[]][]).find(([t]) =>
      t.includes("set status = 'pending'"),
    )
    expect(revert?.[0]).toContain("status = 'applied'")
    expect(revert?.[0]).toContain('decided_by')
  })

  it('(d) invalid: the create command throws DomainError(unknown_team) → proposal terminally failed', async () => {
    createWorkItem.mockReset().mockRejectedValue(new DomainError('unknown_team', 'Unknown team'))
    const { sql, getStatus, query } = makeSql({})
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'invalid' })
    expect(getStatus()).toBe('failed') // terminal, distinct from human 'rejected'
    expect(createWorkItem).toHaveBeenCalledTimes(1)
    // The terminal fail is GUARDED to this call's claimed row (applied + this approver).
    const fail = (query.mock.calls as [string, unknown[]][]).find(([t]) =>
      t.includes("set status = 'failed'"),
    )
    expect(fail?.[0]).toContain("status = 'applied'")
    expect(fail?.[0]).toContain('decided_by')
  })

  it('returns not_found for a proposal outside the caller tenants (no claim)', async () => {
    const sql = vi.fn(async () => []) as unknown as Sql // getProposalScoped → null
    const res = await applyProposal(sql, ctx, 'p_ghost')
    expect(res).toEqual({ applied: false, reason: 'not_found' })
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('returns invalid for an unsupported target/operation AND terminally fails it (never claimed)', async () => {
    const { sql, getStatus } = makeSql({ proposal: { target_type: 'invoice', operation: 'create' } })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'invalid' })
    // A permanently-invalid proposal goes TERMINAL (failed) so it can't sit pending
    // in listPending forever; the command never runs.
    expect(getStatus()).toBe('failed')
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('a proposal with null run_id terminally fails; a second accept is not_pending', async () => {
    const { sql, getStatus } = makeSql({ proposal: { run_id: null } })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'invalid' })
    expect(getStatus()).toBe('failed') // no longer pending → out of listPending
    expect(createWorkItem).not.toHaveBeenCalled()
    // The proposal is now terminal: re-accepting it is a no-op, not a perpetual 422.
    const second = await applyProposal(sql, ctx, 'p1')
    expect(second).toEqual({ applied: false, reason: 'not_pending' })
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
    expect(res).toEqual({ applied: true, result: MEM_ROW })
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

  it('memory:create is IDEMPOTENT — a re-drive with an existing source_proposal_id returns it, no double-create', async () => {
    const existing = { ...MEM_ROW, id: 'mem_existing' }
    getMemoryBySourceProposalId.mockResolvedValue(existing)
    const { sql } = makeSql({ proposal: MEMORY_CREATE })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: true, result: existing })
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
        target_id: 'mem_1',
        payload: { body: 'Reversed', change_reason: 'Mongo chosen' },
      },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: true, result: MEM_ROW })
    expect(supersedeMemory).toHaveBeenCalledTimes(1)
    const [, cmdCtx, targetId, input] = supersedeMemory.mock.calls[0] ?? []
    // Tenant isolation: the command is scoped to the proposal's OWN tenant, so a
    // foreign target id can never be superseded here (the domain returns not_found).
    expect(cmdCtx).toEqual({ tenantIds: ['t_1'], actor: 'run_1' })
    expect(targetId).toBe('mem_1')
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
      proposal: { target_type: 'memory', operation: 'retract', target_id: 'mem_1', payload: {} },
    })
    expect(await applyProposal(retractSql.sql, ctx, 'p1')).toEqual({ applied: true, result: MEM_ROW })
    expect(retractMemory).toHaveBeenCalledWith(retractSql.sql, { tenantIds: ['t_1'], actor: 'run_1' }, 'mem_1')

    const deferSql = makeSql({
      proposal: {
        target_type: 'memory',
        operation: 'defer',
        target_id: 'mem_1',
        payload: { waiting_on: 'legal', review_after: '2026-08-01' },
      },
    })
    expect(await applyProposal(deferSql.sql, ctx, 'p1')).toEqual({ applied: true, result: MEM_ROW })
    const [, , deferTarget, deferInput] = deferMemory.mock.calls[0] ?? []
    expect(deferTarget).toBe('mem_1')
    expect(deferInput).toMatchObject({ waitingOn: 'legal', reviewAfter: '2026-08-01' })
  })

  it('memory supersede DomainError(conflict) → proposal reverts to pending (reviewable, not terminal)', async () => {
    supersedeMemory.mockReset().mockRejectedValue(new DomainError('conflict', 'no longer active'))
    const { sql, getStatus } = makeSql({
      proposal: {
        target_type: 'memory',
        operation: 'supersede',
        target_id: 'mem_1',
        payload: { change_reason: 'x' },
      },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'stale' })
    expect(getStatus()).toBe('pending') // still reviewable, like a stale work-item update
  })

  it('memory supersede DomainError(not_found) on a foreign/vanished target → terminal invalid (never applied)', async () => {
    supersedeMemory.mockReset().mockRejectedValue(new DomainError('not_found', 'Not found'))
    const { sql, getStatus } = makeSql({
      proposal: {
        target_type: 'memory',
        operation: 'supersede',
        target_id: 'foreign_mem',
        payload: { change_reason: 'x' },
      },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'invalid' })
    expect(getStatus()).toBe('failed')
  })

  it('terminally fails an unsupported memory operation (never claimed)', async () => {
    const { sql, getStatus } = makeSql({
      proposal: { target_type: 'memory', operation: 'frobnicate', target_id: 'mem_1', payload: {} },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'invalid' })
    expect(getStatus()).toBe('failed')
    expect(supersedeMemory).not.toHaveBeenCalled()
  })
})
