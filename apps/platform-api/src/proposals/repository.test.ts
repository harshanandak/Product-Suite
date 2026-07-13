import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { createProposal, getProposalScoped, listPending } from './repository'

describe('listPending', () => {
  it('scopes by tenant array and pending status', async () => {
    const sql = vi.fn(async () => [{ id: 'p1' }]) as unknown as Sql
    const rows = await listPending(sql, ['t_1'])
    expect(rows).toHaveLength(1)
    // Tagged-template call: [strings, ...params]; the first param is the tenant array.
    const params = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.slice(1) ?? []
    expect(params[0]).toEqual(['t_1'])
    const text = String((sql as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0])
    expect(text).toContain("status = 'pending'")
  })
})

describe('getProposalScoped', () => {
  it('returns the row when in tenant, null otherwise', async () => {
    const hit = vi.fn(async () => [{ id: 'p1', tenant_id: 't_1' }]) as unknown as Sql
    expect(await getProposalScoped(hit, 'p1', ['t_1'])).toMatchObject({ id: 'p1' })

    const miss = vi.fn(async () => []) as unknown as Sql
    expect(await getProposalScoped(miss, 'p1', ['t_2'])).toBeNull()
  })
})

describe('createProposal', () => {
  it('inserts only allowlisted columns, binds payload as jsonb, returns the row', async () => {
    const created = { id: 'p1', status: 'pending' }
    const query = vi.fn(async () => [created])
    const sql = { query } as unknown as Sql

    const row = await createProposal(sql, {
      tenant_id: 't_1',
      target_type: 'work_item',
      operation: 'create',
      payload: { title: 'A' },
      actor_type: 'agent',
      actor_id: 'run_1',
      on_behalf_of: 'u_1',
      run_id: 'run_1',
    })
    expect(row).toBe(created)
    const [text, params] = (query.mock.calls[0] ?? []) as unknown as [string, unknown[]]
    expect(text).toContain('insert into "proposals"')
    expect(text).toContain('returning *')
    expect(text).toContain('::jsonb') // payload cast
    // payload is stringified for the jsonb bind, not passed as a raw object.
    expect(params).toContain(JSON.stringify({ title: 'A' }))
    expect(params).toContain('t_1')
    expect(params).toContain('agent')
  })
})
