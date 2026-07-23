import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import {
  actorAssignments,
  buildWrite,
  PROVENANCE_COLUMNS,
  recordWrite,
  recordWriteTx,
  type ActorContext,
} from './record-write'

const human: ActorContext = { actorType: 'human', actorId: 'u_1' }

describe('actorAssignments', () => {
  it('returns the four provenance values as a plain object', () => {
    expect(actorAssignments(human)).toEqual({
      actorType: 'human',
      actorId: 'u_1',
      onBehalfOf: null,
      runId: null,
    })
  })

  it('rejects an empty actor_id (no anonymous writes)', () => {
    expect(() => actorAssignments({ actorType: 'human', actorId: '' })).toThrow(/actor_id is required/)
  })

  it('rejects an agent without on_behalf_of / run_id', () => {
    expect(() =>
      actorAssignments({ actorType: 'agent', actorId: 'run_9' } as unknown as ActorContext),
    ).toThrow(/agent write requires on_behalf_of and run_id/)
  })
})

describe('buildWrite — insert', () => {
  it('appends the provenance columns from the server-derived actor', () => {
    const { text, params } = buildWrite(
      { table: 'teams', operation: 'insert', values: { tenant_id: 't_1', name: 'Eng' } },
      human,
    )
    for (const col of PROVENANCE_COLUMNS) expect(text).toContain(`"${col}"`)
    expect(text).toContain('insert into "teams"')
    expect(text).toContain('returning *')
    expect(params).toEqual(['t_1', 'Eng', 'human', 'u_1', null, null])
  })

  it('stamps agent provenance', () => {
    const { params } = buildWrite(
      { table: 'teams', operation: 'insert', values: { tenant_id: 't_1', name: 'Eng' } },
      { actorType: 'agent', actorId: 'run_9', onBehalfOf: 'u_trigger', runId: 'run_9' },
    )
    expect(params).toEqual(['t_1', 'Eng', 'agent', 'run_9', 'u_trigger', 'run_9'])
  })

  it.each(PROVENANCE_COLUMNS)('rejects a caller-supplied provenance column: %s', (col) => {
    expect(() =>
      buildWrite({ table: 'teams', operation: 'insert', values: { name: 'Eng', [col]: 'x' } }, human),
    ).toThrow(/may not set provenance/)
  })

  it('rejects a non-allowlisted column and an unregistered table', () => {
    expect(() =>
      buildWrite({ table: 'teams', operation: 'insert', values: { is_admin: true } }, human),
    ).toThrow(/not an insertable column/)
    expect(() =>
      buildWrite({ table: 'secrets', operation: 'insert', values: { x: 1 } }, human),
    ).toThrow(/not a registered write table/)
  })
})

describe('buildWrite — update', () => {
  it('builds SET … , updated_at=now() WHERE <match> with actor stamped', () => {
    const { text, params } = buildWrite(
      {
        table: 'teams',
        operation: 'update',
        values: { name: 'Renamed' },
        match: { id: 'team_1', tenant_id: 't_1' },
      },
      human,
    )
    expect(text).toMatch(/^update "teams" set /)
    expect(text).toContain('"updated_at" = now()')
    expect(text).toContain('where "id" = ')
    expect(text).toContain('"tenant_id" = ')
    // set values + actor, then the match values last.
    expect(params).toEqual(['Renamed', 'human', 'u_1', null, null, 'team_1', 't_1'])
  })

  it('throws when a required match key is missing (no tenant-scope drop / unqualified UPDATE)', () => {
    expect(() =>
      buildWrite(
        { table: 'teams', operation: 'update', values: { name: 'x' }, match: { id: 'team_1' } },
        human,
      ),
    ).toThrow(/requires match key "tenant_id"/)
    expect(() =>
      buildWrite({ table: 'teams', operation: 'update', values: { name: 'x' }, match: {} }, human),
    ).toThrow(/requires match key/)
  })

  it('compiles an array match value to "col" = any($n), binding the array as ONE param', () => {
    const { text, params } = buildWrite(
      {
        table: 'teams',
        operation: 'update',
        values: { name: 'Renamed' },
        match: { id: ['team_1', 'team_2'], tenant_id: 't_1' },
      },
      human,
    )
    // The array key uses `= any($n)`; the scalar key keeps plain `= $n`. Both are
    // bound params — the array is never expanded into concatenated SQL.
    expect(text).toContain('where "id" = any($6) and "tenant_id" = $7')
    expect(text).not.toContain('any($7)')
    expect(params).toEqual(['Renamed', 'human', 'u_1', null, null, ['team_1', 'team_2'], 't_1'])
  })

  it('still requires tenant_id when the match uses the array form (no array-form bypass)', () => {
    expect(() =>
      buildWrite(
        {
          table: 'teams',
          operation: 'update',
          values: { name: 'x' },
          match: { id: ['team_1', 'team_2'] },
        },
        human,
      ),
    ).toThrow(/requires match key "tenant_id"/)
  })

  it('rejects an array tenant_id — scoping stays a single tenant, never widened', () => {
    expect(() =>
      buildWrite(
        {
          table: 'teams',
          operation: 'update',
          values: { name: 'x' },
          match: { id: 'team_1', tenant_id: ['t_1', 't_2'] },
        },
        human,
      ),
    ).toThrow(/match key "tenant_id" must be a single value/)
  })

  it('rejects an empty array match value (a degenerate, silently no-op predicate)', () => {
    expect(() =>
      buildWrite(
        { table: 'teams', operation: 'update', values: { name: 'x' }, match: { id: [], tenant_id: 't_1' } },
        human,
      ),
    ).toThrow(/match key "id" may not be an empty array/)
  })

  it('rejects a null/undefined element inside an array match value', () => {
    expect(() =>
      buildWrite(
        {
          table: 'teams',
          operation: 'update',
          values: { name: 'x' },
          match: { id: ['team_1', null], tenant_id: 't_1' },
        },
        human,
      ),
    ).toThrow(/match key "id" may not contain a null element/)
  })

  it('rejects a SPARSE HOLE in an array match value (Array.some skips holes)', () => {
    // eslint-disable-next-line no-sparse-arrays -- a sparse hole is precisely the input under test
    const sparse: unknown[] = ['team_1', ,]
    // Guard the premise: a callback-based check would NOT have caught this, which
    // is why the validation walks indices instead.
    expect(sparse).toHaveLength(2)
    expect(sparse.some((element) => element === undefined || element === null)).toBe(false)

    expect(() =>
      buildWrite(
        {
          table: 'teams',
          operation: 'update',
          values: { name: 'x' },
          match: { id: sparse, tenant_id: 't_1' },
        },
        human,
      ),
    ).toThrow(/match key "id" may not contain a null element/)
  })

  it('rejects an unknown match column and a non-updatable set column', () => {
    expect(() =>
      buildWrite(
        {
          table: 'teams',
          operation: 'update',
          values: { name: 'x' },
          match: { id: 'i', tenant_id: 't', role: 'admin' },
        },
        human,
      ),
    ).toThrow(/not a match column/)
    // 'id' is match-only — never an updatable SET column.
    expect(() =>
      buildWrite(
        { table: 'teams', operation: 'update', values: { id: 'evil' }, match: { id: 'i', tenant_id: 't' } },
        human,
      ),
    ).toThrow(/not an updatable column/)
  })
})

describe('recordWrite', () => {
  it('runs the built statement and returns the row', async () => {
    const sql = { query: vi.fn(async (_t: string, _p: unknown[]) => [{ id: 'team_1' }]) } as unknown as Sql
    const row = await recordWrite(
      sql,
      { table: 'teams', operation: 'insert', values: { tenant_id: 't_1', name: 'Eng' } },
      human,
    )
    expect(row).toEqual({ id: 'team_1' })
  })

  it('throws when the write returns no row', async () => {
    const sql = { query: vi.fn(async () => []) } as unknown as Sql
    await expect(
      recordWrite(sql, { table: 'teams', operation: 'insert', values: { name: 'Eng' } }, human),
    ).rejects.toThrow(/returned no row/)
  })
})

describe('recordWriteTx', () => {
  it('runs all specs as one atomic batch and returns the first row of each', async () => {
    const query = vi.fn((t: string) => ({ t }))
    const transaction = vi.fn(async (_queries: unknown[]) => [[{ id: 'wi_1' }], [{ id: 'ev_1' }]])
    const sql = { query, transaction } as unknown as Sql

    const rows = await recordWriteTx(
      sql,
      [
        { table: 'work_items', operation: 'insert', values: { id: 'wi_1', tenant_id: 't_1', title: 'X' } },
        {
          table: 'activity_events',
          operation: 'insert',
          values: { id: 'ev_1', work_item_id: 'wi_1', kind: 'created', summary: 'Created X' },
        },
      ],
      human,
    )

    // One transaction call carrying both built queries; both rows returned in order.
    expect(transaction).toHaveBeenCalledTimes(1)
    expect((transaction.mock.calls[0]?.[0] as unknown[]).length).toBe(2)
    expect(rows).toEqual([{ id: 'wi_1' }, { id: 'ev_1' }])
  })

  it('throws (never shifts) when a statement returns no row — preserves positional alignment', async () => {
    const query = vi.fn((t: string) => ({ t }))
    // First statement returns nothing; the naive filter-drop would hand the caller
    // the SECOND statement's row as if it were the first. We throw instead.
    const transaction = vi.fn(async (_q: unknown[]) => [[], [{ id: 'ev_1' }]])
    const sql = { query, transaction } as unknown as Sql

    await expect(
      recordWriteTx(
        sql,
        [
          { table: 'work_items', operation: 'insert', values: { id: 'wi_1', tenant_id: 't_1', title: 'X' } },
          {
            table: 'activity_events',
            operation: 'insert',
            values: { id: 'ev_1', work_item_id: 'wi_1', kind: 'created', summary: 'X' },
          },
        ],
        human,
      ),
    ).rejects.toThrow(/work_items.*returned no row/)
  })
})
