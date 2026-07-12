import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { PROVENANCE_COLUMNS, recordWrite } from './record-write'

/**
 * A minimal Neon `sql` stub. recordWrite calls it in ordinary form —
 * `sql(text, params)` — so the mock IS the query fn; `query` aliases it for the
 * assertions below.
 */
function stubSql(returnRows: unknown[] = [{ id: 'team_1' }]) {
  const query = vi.fn(async (_text: string, _params: unknown[]) => returnRows)
  const sql = query as unknown as Sql
  return { sql, query }
}

const human = { actorType: 'human', actorId: 'u_1' } as const

describe('recordWrite', () => {
  it('appends the four provenance columns from the server-derived actor', async () => {
    const { sql, query } = stubSql()

    await recordWrite(sql, 'teams', { tenant_id: 't_1', name: 'Eng' }, human)

    const [text, params] = query.mock.calls[0] ?? []
    // Every provenance column is present in the generated insert.
    for (const col of PROVENANCE_COLUMNS) {
      expect(text).toContain(`"${col}"`)
    }
    // Values: the allowlisted data first, then actor_type/actor_id/on_behalf_of/run_id.
    expect(params).toEqual(['t_1', 'Eng', 'human', 'u_1', null, null])
  })

  it('stamps agent provenance (actor_id=run, on_behalf_of=triggerer, run_id) for an agent write', async () => {
    const { sql, query } = stubSql()

    await recordWrite(
      sql,
      'teams',
      { tenant_id: 't_1', name: 'Eng' },
      { actorType: 'agent', actorId: 'run_9', onBehalfOf: 'u_trigger', runId: 'run_9' },
    )

    const params = query.mock.calls[0]?.[1] as unknown[]
    expect(params).toEqual(['t_1', 'Eng', 'agent', 'run_9', 'u_trigger', 'run_9'])
  })

  it.each(PROVENANCE_COLUMNS)('rejects a caller-supplied provenance column: %s', async (col) => {
    const { sql, query } = stubSql()
    await expect(
      recordWrite(sql, 'teams', { tenant_id: 't_1', name: 'Eng', [col]: 'spoof' }, human),
    ).rejects.toThrow(/may not set provenance/)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a column that is not allowlisted for the table (no arbitrary injection)', async () => {
    const { sql, query } = stubSql()
    await expect(
      recordWrite(sql, 'teams', { tenant_id: 't_1', name: 'Eng', is_admin: true }, human),
    ).rejects.toThrow(/not an insertable column/)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects an agent write missing on_behalf_of or run_id (no anonymous agent writes)', async () => {
    const { sql, query } = stubSql()
    // A loosely-typed caller tries to stamp an agent write without the human/run.
    await expect(
      recordWrite(sql, 'teams', { tenant_id: 't_1', name: 'Eng' }, {
        actorType: 'agent',
        actorId: 'run_9',
      } as unknown as Parameters<typeof recordWrite>[3]),
    ).rejects.toThrow(/agent write requires on_behalf_of and run_id/)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a write with an empty actor_id', async () => {
    const { sql, query } = stubSql()
    await expect(
      recordWrite(sql, 'teams', { tenant_id: 't_1', name: 'Eng' }, { actorType: 'human', actorId: '' }),
    ).rejects.toThrow(/actor_id is required/)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects an unregistered table', async () => {
    const { sql, query } = stubSql()
    await expect(recordWrite(sql, 'secrets', { name: 'x' }, human)).rejects.toThrow(
      /not a registered write table/,
    )
    expect(query).not.toHaveBeenCalled()
  })

  it('throws when the insert returns no row', async () => {
    const { sql } = stubSql([])
    await expect(recordWrite(sql, 'teams', { tenant_id: 't_1', name: 'Eng' }, human)).rejects.toThrow(
      /returned no row/,
    )
  })
})
