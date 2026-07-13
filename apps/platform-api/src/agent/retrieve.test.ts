import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { retrieve } from './retrieve'

/** A fake neon client: tagged-template callable with a `.query(text, params)` method. */
function fakeSql(rows: unknown[]) {
  const query = vi.fn(async (_text: string, _params: unknown[]) => rows)
  const sql = vi.fn(async () => rows) as unknown as Sql & { query: typeof query }
  ;(sql as unknown as { query: typeof query }).query = query
  return { sql, query }
}

describe('retrieve() seam', () => {
  it('scopes by the caller tenant array and returns compact hits only', async () => {
    const { sql, query } = fakeSql([
      {
        id: 'wi_1',
        title: 'Auth login bug',
        status_id: 's_1',
        priority: 'high',
        team_id: 'team_1',
        // Extra columns the DB might return must NOT leak into the projection.
        description: 'long body that should never reach the model',
        tenant_id: 't_1',
      },
    ])

    const hits = await retrieve(sql, { tenantIds: ['t_1', 't_2'] }, 'auth', 5)

    // Compact projection: exactly the five ItemHit fields, nothing else.
    expect(hits).toEqual([
      { id: 'wi_1', title: 'Auth login bug', status_id: 's_1', priority: 'high', team_id: 'team_1' },
    ])
    expect(Object.keys(hits[0] ?? {})).toEqual(['id', 'title', 'status_id', 'priority', 'team_id'])

    // Tenant-scoped + parameterized: the tenant array, the ILIKE term, and the
    // limit are all bound params — never interpolated, never trusting the query.
    const [text, params] = query.mock.calls[0] ?? []
    expect(String(text)).toMatch(/work_items/i)
    expect(String(text)).toMatch(/ilike/i)
    expect(params?.[0]).toEqual(['t_1', 't_2'])
    expect(params?.[1]).toBe('%auth%')
    expect(params?.[2]).toBe(5)
  })

  it('denies (returns []) with no tenants and never touches the DB', async () => {
    const { sql, query } = fakeSql([{ id: 'x' }])
    const hits = await retrieve(sql, { tenantIds: [] }, 'auth')
    expect(hits).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it('treats a blank query as no-op (no raw dump) and skips the DB', async () => {
    const { sql, query } = fakeSql([{ id: 'x' }])
    const hits = await retrieve(sql, { tenantIds: ['t_1'] }, '   ')
    expect(hits).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })
})
