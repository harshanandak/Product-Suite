import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import {
  createMemory,
  deferMemory,
  retractMemory,
  supersedeMemory,
  type MemoryRow,
} from './memories'

const ROW: MemoryRow = {
  id: 'm_1',
  tenant_id: 't_1',
  kind: 'decision',
  title: 'Use Postgres',
  body: 'We picked Postgres over Mongo.',
  attrs: null,
  root_id: 'm_1',
  supersedes_id: null,
  superseded_by_id: null,
  change_reason: null,
  valid_from: '2026-07-15T00:00:00.000Z',
  status: 'active',
  waiting_on: null,
  review_after: null,
  scope_type: 'org',
  scope_id: null,
  topics: ['db'],
  source_kind: 'manual',
  source_run_id: null,
  source_proposal_id: null,
  source_quote: null,
  created_by: 'u_1',
  decided_by: null,
  pinned: false,
  priority: 0,
  enforcement: 'advisory',
  created_at: '2026-07-15T00:00:00.000Z',
  updated_at: '2026-07-15T00:00:00.000Z',
}

/** A mock Sql whose `query(text, params)` dispatches by matching the SQL text. */
function mockSql(dispatch: (text: string, params: unknown[]) => unknown[]) {
  const query = vi.fn(async (text: string, params: unknown[]) => dispatch(text, params))
  const transaction = vi.fn()
  const sql = { query, transaction } as unknown as Sql
  return { sql, query, transaction }
}

describe('createMemory', () => {
  it('inserts a NEW chain head (root_id = id), active, stamping created_by = actor', async () => {
    const { sql, query } = mockSql((text) => (/insert into "memories"/i.test(text) ? [ROW] : []))
    const created = await createMemory(
      sql,
      { tenantId: 't_1', actor: 'u_1' },
      { kind: 'decision', title: 'Use Postgres', body: 'x', topics: ['db'] },
    )
    expect(created.id).toBe('m_1')
    const [text, params] = query.mock.calls[0]!
    // root_id binds to the same $1 as id (a new memory is its own chain head).
    expect(String(text)).toMatch(/"root_id"/)
    expect(String(text)).toMatch(/'active'/)
    // params: [id, tenant, kind, title, body, attrs, scope_type, scope_id, topics,
    //          source_kind, source_run_id, source_proposal_id, source_quote, created_by, decided_by]
    expect(params[1]).toBe('t_1')
    expect(params[2]).toBe('decision')
    expect(params[13]).toBe('u_1') // created_by = the server actor
  })

  it('rejects an empty title with invalid_input (never a spoofed row)', async () => {
    const { sql } = mockSql(() => [])
    await expect(
      createMemory(sql, { tenantId: 't_1', actor: 'u_1' }, { kind: 'fact', title: '   ' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('supersedeMemory (append-only versioning)', () => {
  it('requires a change_reason', async () => {
    const { sql } = mockSql(() => [ROW])
    await expect(
      supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', { changeReason: '  ' }),
    ).rejects.toMatchObject({ code: 'change_reason_required' })
  })

  it('is not_found for a foreign/unknown id (no cross-tenant leak)', async () => {
    const { sql } = mockSql((text) => (/select \* from "memories"/i.test(text) ? [] : []))
    await expect(
      supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'foreign', {
        changeReason: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('inserts a NEW version + latches the old in ONE atomic batch, resolving to the new row', async () => {
    const NEW = { ...ROW, id: 'm_2', supersedes_id: 'm_1', change_reason: 'Mongo was chosen instead' }
    const { sql, query, transaction } = mockSql((text) =>
      /select \* from "memories"/i.test(text) ? [ROW] : [],
    )
    transaction.mockResolvedValue([[NEW], [{ id: 'm_1' }]])
    const updated = await supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', {
      title: 'Use MongoDB',
      changeReason: 'Mongo was chosen instead',
    })
    expect(updated.id).toBe('m_2')
    expect(updated.supersedes_id).toBe('m_1')
    // The batch had exactly two statements: the INSERT…SELECT (new version) + the
    // latch UPDATE (old row). Both guard on the old row being 'active'.
    expect(transaction).toHaveBeenCalledTimes(1)
    const built = query.mock.calls.map(([t]) => String(t))
    const insert = built.find((t) => /insert into "memories"[\s\S]*select/i.test(t))
    const latch = built.find((t) => /update "memories"[\s\S]*superseded_by_id/i.test(t))
    expect(insert).toMatch(/"status" = 'active'/)
    expect(insert).toMatch(/"supersedes_id"|"id"/)
    expect(latch).toMatch(/'superseded'/)
    expect(latch).toMatch(/"status" = 'active'/)
  })

  it('is a conflict when the target is no longer active (lost race, no orphan version)', async () => {
    const { sql, transaction } = mockSql((text) =>
      /select \* from "memories"/i.test(text) ? [{ ...ROW, status: 'superseded' }] : [],
    )
    // Atomic batch: the INSERT…SELECT matched 0 rows (old not active) ⇒ empty insert.
    transaction.mockResolvedValue([[], []])
    await expect(
      supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', { changeReason: 'x' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('retractMemory / deferMemory (keep history)', () => {
  it('retract sets status=retracted and KEEPS the row', async () => {
    const RETRACTED = { ...ROW, status: 'retracted' as const }
    const { sql, query } = mockSql((text) => {
      if (/update "memories"/i.test(text)) return [RETRACTED]
      return [ROW] // getMemoryScoped
    })
    const out = await retractMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1')
    expect(out.status).toBe('retracted')
    const upd = query.mock.calls.find(([t]) => /update "memories"/i.test(String(t)))!
    expect(String(upd[0])).toMatch(/'retracted'/)
    // History kept: it is an UPDATE of status, never a DELETE.
    expect(String(upd[0])).not.toMatch(/delete/i)
  })

  it('retract is not_found for a foreign id', async () => {
    const { sql } = mockSql(() => [])
    await expect(
      retractMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'foreign'),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('defer sets status=deferred + waiting_on/review_after and keeps the row', async () => {
    const DEFERRED = { ...ROW, status: 'deferred' as const, waiting_on: 'legal' }
    const { sql, query } = mockSql((text) => {
      if (/update "memories"/i.test(text)) return [DEFERRED]
      return [ROW]
    })
    const out = await deferMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', {
      waitingOn: 'legal',
      reviewAfter: '2026-08-01',
    })
    expect(out.status).toBe('deferred')
    const upd = query.mock.calls.find(([t]) => /update "memories"/i.test(String(t)))!
    expect(upd[1]).toEqual(['m_1', ['t_1'], 'legal', '2026-08-01'])
  })

  it('defer is not_found for a foreign id', async () => {
    const { sql } = mockSql(() => [])
    await expect(
      deferMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'foreign', {}),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
