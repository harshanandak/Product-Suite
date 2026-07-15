import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import {
  createMemory,
  deferMemory,
  getMemoryBySourceProposalId,
  reactivateMemory,
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

  it('requires a valid UUID scope_id for a non-org scope (never a black-hole memory)', async () => {
    const { sql } = mockSql(() => [ROW])
    // A non-org scope with no scope_id would never be retrievable (the cascade matches
    // scope_id) — reject it rather than silently create a dead memory.
    await expect(
      createMemory(sql, { tenantId: 't_1', actor: 'u_1' }, { kind: 'decision', title: 'x', scopeType: 'project' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    // A non-UUID scope_id is a 400, not a Postgres cast 500.
    await expect(
      createMemory(sql, { tenantId: 't_1', actor: 'u_1' }, {
        kind: 'decision',
        title: 'x',
        scopeType: 'project',
        scopeId: 'not-a-uuid',
      }),
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

  it('rejects a provided-but-blank title/body as invalid_input (never silently blanks the field)', async () => {
    const { sql, query } = mockSql(() => [ROW])
    await expect(
      supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', { changeReason: 'x', title: '   ' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', { changeReason: 'x', body: '' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    // The blank never reached the CTE write.
    expect(query.mock.calls.some(([t]) => /with "latched" as/i.test(String(t)))).toBe(false)
  })

  it('is not_found for a foreign/unknown id (no cross-tenant leak)', async () => {
    const { sql } = mockSql((text) => (/select \* from "memories"/i.test(text) ? [] : []))
    await expect(
      supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'foreign', {
        changeReason: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('stamps agent source provenance (source_kind/source_run_id/source_proposal_id) on the new version', async () => {
    const NEW = { ...ROW, id: 'm_2', supersedes_id: 'm_1', source_kind: 'proposal' as const }
    const { sql, query } = mockSql((text) => {
      if (/with "latched" as/i.test(text)) return [NEW]
      if (/select \* from "memories"/i.test(text)) return [ROW]
      return []
    })
    await supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'run_1' }, 'm_1', {
      body: 'Reversed',
      changeReason: 'Mongo chosen',
      sourceKind: 'proposal',
      sourceRunId: 'run_1',
      sourceProposalId: 'prop_9',
    })
    const cte = query.mock.calls.find(([t]) => /with "latched" as/i.test(String(t)))!
    // The new version row records where it came from — the proposal + run.
    expect(String(cte[0])).toMatch(/"source_run_id"/)
    expect(String(cte[0])).toMatch(/"source_proposal_id"/)
    expect(cte[1]).toContain('proposal')
    expect(cte[1]).toContain('run_1')
    expect(cte[1]).toContain('prop_9')
  })

  it('inserts a NEW version + latches the old in ONE atomic CTE, resolving to the new row', async () => {
    const NEW = { ...ROW, id: 'm_2', supersedes_id: 'm_1', change_reason: 'Mongo was chosen instead' }
    const { sql, query } = mockSql((text) => {
      if (/with "latched" as/i.test(text)) return [NEW] // the CTE returns the new active version
      if (/select \* from "memories"/i.test(text)) return [ROW] // ownership check
      return []
    })
    const updated = await supersedeMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', {
      title: 'Use MongoDB',
      changeReason: 'Mongo was chosen instead',
    })
    expect(updated.id).toBe('m_2')
    expect(updated.supersedes_id).toBe('m_1')
    // ONE atomic statement (CTE): latch the old row FIRST (guarded on 'active'), then
    // INSERT the new version FROM the `latched` CTE — so a concurrent supersede can't
    // fork the chain into two active heads (a separate insert+latch could).
    const cte = query.mock.calls.map(([t]) => String(t)).find((t) => /with "latched" as/i.test(t))
    expect(cte).toBeDefined()
    expect(cte).toMatch(/'superseded'/) // latch flips the old row
    expect(cte).toMatch(/"status" = 'active'/) // …guarded on the old row still being active
    expect(cte).toMatch(/insert into "memories"[\s\S]*from "latched"/i) // insert ONLY from the latched row
  })

  it('is a conflict when the target is no longer active (lost race, no orphan version)', async () => {
    // Ownership finds the row (exists) but it is not active; the CTE latches 0 rows ⇒
    // inserts 0 ⇒ the supersede returns no new version (never a second active head).
    const { sql } = mockSql((text) =>
      /select \* from "memories"/i.test(text) ? [{ ...ROW, status: 'superseded' }] : [],
    )
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

  it('reactivate moves a deferred memory back to active (not a dead end)', async () => {
    const ACTIVE = { ...ROW, status: 'active' as const }
    const { sql, query } = mockSql((text) => {
      if (/update "memories"/i.test(text)) return [ACTIVE]
      return [{ ...ROW, status: 'deferred' as const }] // getMemoryScoped
    })
    const out = await reactivateMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1')
    expect(out.status).toBe('active')
    const upd = query.mock.calls.find(([t]) => /update "memories"/i.test(String(t)))!
    expect(String(upd[0])).toMatch(/"status" = 'deferred'/) // guarded: only a deferred memory reactivates
    expect(String(upd[0])).toMatch(/"waiting_on" = null/) // the pause context is cleared
  })

  it('defer is not_found for a foreign id', async () => {
    const { sql } = mockSql(() => [])
    await expect(
      deferMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'foreign', {}),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('defer rejects a free-form review_after as invalid_input (never a timestamptz cast 500)', async () => {
    // A bad value must fail BEFORE the DB write with invalid_input (→ apply maps it to
    // a terminal `failed`), never bind to the timestamptz param and wedge the proposal.
    const { sql, query } = mockSql(() => [ROW])
    await expect(
      deferMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', { reviewAfter: 'next quarter' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    // The write never ran — the bad value never reached Postgres.
    expect(query).not.toHaveBeenCalled()
  })

  it('defer accepts a valid ISO review_after and binds it as the param', async () => {
    const DEFERRED = { ...ROW, status: 'deferred' as const, review_after: '2026-08-01' }
    const { sql, query } = mockSql((text) => (/update "memories"/i.test(text) ? [DEFERRED] : [ROW]))
    await deferMemory(sql, { tenantIds: ['t_1'], actor: 'u_1' }, 'm_1', { reviewAfter: '2026-08-01' })
    const upd = query.mock.calls.find(([t]) => /update "memories"/i.test(String(t)))!
    expect(upd[1]).toEqual(['m_1', ['t_1'], null, '2026-08-01'])
  })
})

describe('getMemoryBySourceProposalId (idempotent re-drive lookup)', () => {
  it('returns the memory already created from a proposal, scoped to the tenants', async () => {
    const FROM_PROP = { ...ROW, source_kind: 'proposal' as const, source_proposal_id: 'prop_9' }
    const { sql, query } = mockSql(() => [FROM_PROP])
    const found = await getMemoryBySourceProposalId(sql, 'prop_9', ['t_1'])
    expect(found?.id).toBe('m_1')
    const [text, params] = query.mock.calls[0]!
    expect(String(text)).toMatch(/"source_proposal_id" = \$1/)
    expect(String(text)).toMatch(/tenant_id/)
    expect(params).toEqual(['prop_9', ['t_1']])
  })

  it('returns null when no memory has been created from the proposal yet', async () => {
    const { sql } = mockSql(() => [])
    expect(await getMemoryBySourceProposalId(sql, 'prop_x', ['t_1'])).toBeNull()
  })
})
