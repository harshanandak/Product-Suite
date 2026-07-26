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

  // F5(a): the Inbox diff's "before" side must be the state the proposal was AUTHORED
  // against. That state only exists at DRAFT time, so it is captured here — inside the
  // one insert every creation path goes through — rather than left to each caller.
  describe('target_snapshot (the authored-against before-image)', () => {
    function sqlWithTarget(rowJson: Record<string, unknown> | null) {
      const query = vi.fn(async () => [{ id: 'p1', status: 'pending' }])
      const read = vi.fn(async (..._args: unknown[]) =>
        rowJson === null ? [] : [{ row_json: rowJson }],
      )
      const sql = read as unknown as Sql
      ;(sql as unknown as { query: typeof query }).query = query
      return { sql, query, read }
    }

    const TARGET = '44444444-4444-4444-8444-444444444444'

    it('captures the target’s CURRENT values for the payload fields on a work_item update', async () => {
      const { sql, query, read } = sqlWithTarget({
        title: 'Seed item (pre-existing)',
        priority: 'high',
        phase: 'plan',
      })

      await createProposal(sql, {
        tenant_id: 't_1',
        target_type: 'work_item',
        target_id: TARGET,
        operation: 'update',
        payload: { title: 'Renamed', priority: 'critical' },
      })

      // Read through Postgres's OWN jsonb rendering: the accept-time fence compares
      // against `to_jsonb(work_items)`, so a driver-decoded Date would false-conflict.
      expect(String(read.mock.calls[0]?.[0])).toContain('to_jsonb(work_items)')
      const [text, params] = (query.mock.calls[0] ?? []) as unknown as [string, unknown[]]
      expect(text).toContain('"target_snapshot"')
      // ONLY the fields the payload touches — an unrelated column drifting later is
      // not this proposal's business and must not read as staleness.
      const snapshotParam = params.find(
        (p): p is string => typeof p === 'string' && p.includes('Seed item (pre-existing)'),
      )
      expect(snapshotParam).toBeDefined()
      expect(JSON.parse(snapshotParam as string)).toEqual({
        title: 'Seed item (pre-existing)',
        priority: 'high',
      })
    })

    it('captures nothing for a create, a memory op, or a vanished target', async () => {
      for (const input of [
        { target_type: 'work_item', operation: 'create', target_id: null },
        { target_type: 'memory', operation: 'supersede', target_id: TARGET },
      ] as const) {
        const { sql, query, read } = sqlWithTarget({ title: 'x' })
        await createProposal(sql, {
          tenant_id: 't_1',
          payload: { title: 'A' },
          ...input,
        })
        expect(read).not.toHaveBeenCalled()
        const [text] = (query.mock.calls[0] ?? []) as unknown as [string, unknown[]]
        expect(text).not.toContain('"target_snapshot"')
      }

      // The target row is gone: no snapshot rather than an invented one.
      const missing = sqlWithTarget(null)
      await createProposal(missing.sql, {
        tenant_id: 't_1',
        target_type: 'work_item',
        target_id: TARGET,
        operation: 'update',
        payload: { title: 'A' },
      })
      const [text] = (missing.query.mock.calls[0] ?? []) as unknown as [string, unknown[]]
      expect(text).not.toContain('"target_snapshot"')
    })

    it('never fails the draft when the snapshot read throws', async () => {
      const query = vi.fn(async () => [{ id: 'p1', status: 'pending' }])
      const read = vi.fn(async () => {
        throw new Error('read timeout')
      })
      const sql = read as unknown as Sql
      ;(sql as unknown as { query: typeof query }).query = query

      // Drafting the proposal matters more than being able to diff it perfectly.
      await expect(
        createProposal(sql, {
          tenant_id: 't_1',
          target_type: 'work_item',
          target_id: TARGET,
          operation: 'update',
          payload: { title: 'A' },
        }),
      ).resolves.toMatchObject({ id: 'p1' })
    })
  })
})
