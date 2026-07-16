import { describe, expect, it, vi } from 'vitest'

import { clusterCorrections, RECURRENCE_THRESHOLD, runReflection } from './reflection'

describe('clusterCorrections', () => {
  const corr = (id: string, from: string, to: string) => ({
    proposalId: id,
    targetType: 'work_item',
    payload: { title: from, priority: 'low' },
    editedPayload: { title: to, priority: 'low' },
  })

  it('groups corrections that edit the SAME field-set, keeping only >= threshold', () => {
    const clusters = clusterCorrections([
      corr('p1', 'A very long verbose title', 'Short title'),
      corr('p2', 'Another verbose long title', 'Short title 2'),
      // a single unrelated priority edit — sub-threshold, must NOT cluster
      { proposalId: 'p3', targetType: 'work_item', payload: { priority: 'low' }, editedPayload: { priority: 'high' } },
    ])
    expect(RECURRENCE_THRESHOLD).toBe(2)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.corrections.map((c) => c.proposalId)).toEqual(['p1', 'p2'])
    expect(clusters[0]!.fieldSetKey).toBe('title')
  })

  it('returns no cluster when a field-set occurs only once', () => {
    expect(clusterCorrections([corr('p1', 'x', 'y')])).toHaveLength(0)
  })
})

describe('runReflection', () => {
  // mockSql returns corrections on the SELECT, a minted run on the agent_runs insert,
  // created proposals on the proposals insert, and records the reflected_at UPDATE.
  function harness(corrections: any[]) {
    const created: any[] = []
    const stamped: string[][] = []
    const query = vi.fn(async (text: string, params: any[]) => {
      if (/from "proposals"/i.test(text) && /edited_payload/i.test(text)) return corrections
      if (/insert into "agent_runs"/i.test(text)) return [{ id: 'run_reflect' }]
      if (/insert into "proposals"/i.test(text)) { const row = { id: `rp_${created.length}` }; created.push({ text, params }); return [row] }
      if (/from "memories"/i.test(text)) return [] // dedup: nothing existing
      if (/update "proposals"/i.test(text) && /reflected_at/i.test(text)) { stamped.push(params); return [] }
      if (/update "agent_runs"/i.test(text)) return []
      return []
    })
    const sql = { query } as any
    return { sql, query, created, stamped }
  }

  it('proposes one rule per >=2 cluster, stamps ONLY consumed corrections, mints a reflection run', async () => {
    const corrections = [
      { id: 'p1', target_type: 'work_item', payload: { title: 'long a' }, edited_payload: { title: 'a' } },
      { id: 'p2', target_type: 'work_item', payload: { title: 'long b' }, edited_payload: { title: 'b' } },
      { id: 'p3', target_type: 'work_item', payload: { priority: 'low' }, edited_payload: { priority: 'high' } }, // singleton
    ]
    const { sql, created, stamped } = harness(corrections)
    const distill = vi.fn(async () => ({ directive: 'Prefer concise titles', applies_when: 'work items' }))
    const result = await runReflection(sql, { tenantId: 't_1', now: new Date('2026-07-16T00:00:00Z'), distill })

    expect(result.proposalsCreated).toBe(1)
    expect(distill).toHaveBeenCalledTimes(1) // only the title cluster
    // The reflection run is the proposal actor:
    expect(created[0].params).toContain('run_reflect')
    // Only p1+p2 (the consumed cluster) are stamped; p3 stays NULL:
    const stampedIds = stamped.flat()
    expect(stampedIds).toContain('p1')
    expect(stampedIds).toContain('p2')
    expect(stampedIds).not.toContain('p3')
  })

  it('creates nothing and mints no proposals when no cluster reaches threshold', async () => {
    const { sql, created } = harness([
      { id: 'p1', target_type: 'work_item', payload: { title: 'x' }, edited_payload: { title: 'y' } },
    ])
    const distill = vi.fn(async () => ({ directive: 'd', applies_when: 'w' }))
    const result = await runReflection(sql, { tenantId: 't_1', now: new Date('2026-07-16T00:00:00Z'), distill })
    expect(result.proposalsCreated).toBe(0)
    expect(distill).not.toHaveBeenCalled()
    expect(created).toHaveLength(0)
  })
})
