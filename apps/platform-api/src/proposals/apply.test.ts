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

  return { sql, getStatus: () => status }
}

const ctx = { tenantIds: ['t_1'], approverUserId: 'u_approver' }

describe('applyProposal (Design C: claim-then-command)', () => {
  beforeEach(() => {
    createWorkItem.mockReset().mockResolvedValue(WI_ROW)
    updateWorkItem.mockReset().mockResolvedValue(WI_ROW)
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
    const { sql } = makeSql({})
    const [a, b] = await Promise.all([applyProposal(sql, ctx, 'p1'), applyProposal(sql, ctx, 'p1')])
    const applied = [a, b].filter((r) => r.applied)
    const rejected = [a, b].filter((r) => !r.applied)
    expect(applied).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toEqual({ applied: false, reason: 'not_pending' })
    // The claim gate let exactly one winner reach the command.
    expect(createWorkItem).toHaveBeenCalledTimes(1)
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
    const { sql, getStatus } = makeSql({
      proposal: { operation: 'update', target_id: 'wi_1', payload: { phase: 'done' } },
    })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'stale' })
    expect(getStatus()).toBe('pending') // reverted → still reviewable
    expect(updateWorkItem).toHaveBeenCalledTimes(1)
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('(d) invalid: the create command throws DomainError(unknown_team) → proposal terminally failed', async () => {
    createWorkItem.mockReset().mockRejectedValue(new DomainError('unknown_team', 'Unknown team'))
    const { sql, getStatus } = makeSql({})
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'invalid' })
    expect(getStatus()).toBe('failed') // terminal, distinct from human 'rejected'
    expect(createWorkItem).toHaveBeenCalledTimes(1)
  })

  it('returns not_found for a proposal outside the caller tenants (no claim)', async () => {
    const sql = vi.fn(async () => []) as unknown as Sql // getProposalScoped → null
    const res = await applyProposal(sql, ctx, 'p_ghost')
    expect(res).toEqual({ applied: false, reason: 'not_found' })
    expect(createWorkItem).not.toHaveBeenCalled()
  })

  it('returns invalid for an unsupported target/operation (before any claim)', async () => {
    const { sql, getStatus } = makeSql({ proposal: { target_type: 'invoice', operation: 'create' } })
    const res = await applyProposal(sql, ctx, 'p1')
    expect(res).toEqual({ applied: false, reason: 'invalid' })
    expect(getStatus()).toBe('pending') // never claimed
    expect(createWorkItem).not.toHaveBeenCalled()
  })
})
