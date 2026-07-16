import { describe, expect, it, vi } from 'vitest'

import { computeMemoryImpact, decideVerdict, newcombeDiffCI } from './memory-impact'

describe('newcombeDiffCI', () => {
  it('brackets the point difference and is symmetric-ish', () => {
    const ci = newcombeDiffCI(15, 30, 5, 30) // p1=.5, p2=.167, diff≈.333
    expect(ci.lower).toBeLessThan(0.333)
    expect(ci.upper).toBeGreaterThan(0.333)
    expect(ci.lower).toBeGreaterThan(0) // a strong positive separates from 0
  })
  it('a tiny sample does NOT separate from 0', () => {
    const ci = newcombeDiffCI(3, 4, 1, 4)
    expect(ci.lower).toBeLessThanOrEqual(0) // CI straddles 0 → insufficient
  })
})

describe('decideVerdict', () => {
  const base = { holdout: { applied: 40, rejected: 5, rejectRate: 0.11 }, treated: { applied: 200, rejected: 24, rejectRate: 0.11 } }
  it('helps when ciLow>0 and samples sufficient and reject rates close', () => {
    expect(decideVerdict({ ...base, ciLow: 0.05, ciHigh: 0.2 })).toBe('helps')
  })
  it('hurts when ciHigh<0', () => {
    expect(decideVerdict({ ...base, ciLow: -0.2, ciHigh: -0.03 })).toBe('hurts')
  })
  it('insufficient when the CI straddles 0', () => {
    expect(decideVerdict({ ...base, ciLow: -0.05, ciHigh: 0.08 })).toBe('insufficient')
  })
  it('insufficient below MIN_SAMPLE', () => {
    expect(decideVerdict({ holdout: { applied: 5, rejected: 0, rejectRate: 0 }, treated: { applied: 200, rejected: 10, rejectRate: 0.05 }, ciLow: 0.1, ciHigh: 0.3 })).toBe('insufficient')
  })
  it('insufficient when reject rates diverge materially (collider guard)', () => {
    expect(decideVerdict({ holdout: { applied: 40, rejected: 20, rejectRate: 0.33 }, treated: { applied: 200, rejected: 10, rejectRate: 0.05 }, ciLow: 0.1, ciHigh: 0.3 })).toBe('insufficient')
  })
})

describe('computeMemoryImpact', () => {
  // mockSql: single grouped-aggregate query returns per-cohort rows keyed on memory_holdout.
  function harness(rows: Array<{ memory_holdout: boolean; applied: number; edited: number; rejected: number }>) {
    const query = vi.fn(async (_text: string, _params: unknown[]) => rows)
    const sql = { query } as any
    return { sql, query }
  }

  it('queries proposals joined to agent_runs, filters kind=chat + window + tenant, groups by memory_holdout', async () => {
    const { sql, query } = harness([
      { memory_holdout: true, applied: 40, edited: 20, rejected: 5 },
      { memory_holdout: false, applied: 200, edited: 40, rejected: 24 },
    ])
    await computeMemoryImpact(sql, ['t_1'], 30)

    expect(query).toHaveBeenCalledTimes(1)
    const [text, params] = query.mock.calls[0] as [string, unknown[]]
    expect(text).toMatch(/from "proposals" p/)
    expect(text).toMatch(/join "agent_runs" r on r\.id = p\.run_id/)
    expect(text).toMatch(/r\.kind = 'chat'/)
    expect(text).toMatch(/p\.decided_at >= now\(\) - \(\$2 \|\| ' days'\)::interval/)
    expect(text).toMatch(/p\.tenant_id = any\(\$1\)/)
    expect(text).toMatch(/group by r\."memory_holdout"/)
    expect(params).toEqual([['t_1'], '30'])
  })

  it('assembles editRate/rejectRate, signed delta, savedEdits, and verdict from decideVerdict', async () => {
    // holdout: 40 applied, 20 edited -> editRate .5, 5 rejected -> rejectRate 5/45≈.111
    // treated: 200 applied, 40 edited -> editRate .2, 24 rejected -> rejectRate 24/224≈.107
    const { sql } = harness([
      { memory_holdout: true, applied: 40, edited: 20, rejected: 5 },
      { memory_holdout: false, applied: 200, edited: 40, rejected: 24 },
    ])
    const result = await computeMemoryImpact(sql, ['t_1'], 30)

    expect(result.window_days).toBe(30)
    expect(result.holdout.editRate).toBeCloseTo(0.5, 6)
    expect(result.treated.editRate).toBeCloseTo(0.2, 6)
    expect(result.holdout.rejectRate).toBeCloseTo(5 / 45, 6)
    expect(result.treated.rejectRate).toBeCloseTo(24 / 224, 6)
    expect(result.delta).toBeCloseTo(0.3, 6) // holdout edits MORE
    expect(result.savedEdits).toBe(Math.round(0.3 * 200)) // 60
    expect(result.verdict).toBe(decideVerdict({ holdout: result.holdout, treated: result.treated, ciLow: result.ciLow, ciHigh: result.ciHigh }))
  })

  it('savedEdits is SIGNED — a negative delta (memory hurts) yields negative savedEdits, never floored', async () => {
    // holdout edits LESS than treated -> delta negative
    const { sql } = harness([
      { memory_holdout: true, applied: 40, edited: 4, rejected: 2 }, // editRate .1
      { memory_holdout: false, applied: 200, edited: 60, rejected: 10 }, // editRate .3
    ])
    const result = await computeMemoryImpact(sql, ['t_1'], 30)
    expect(result.delta).toBeLessThan(0)
    expect(result.savedEdits).toBe(Math.round(result.delta * 200))
    expect(result.savedEdits).toBeLessThan(0)
  })

  it('defaults missing cohort rows to zeros (no rows for one side)', async () => {
    const { sql } = harness([{ memory_holdout: false, applied: 200, edited: 40, rejected: 24 }])
    const result = await computeMemoryImpact(sql, ['t_1'])
    expect(result.holdout).toEqual({ applied: 0, edited: 0, rejected: 0, editRate: 0, rejectRate: 0 })
    expect(result.window_days).toBe(30) // default windowDays
  })
})
