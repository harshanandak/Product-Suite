import { describe, expect, it } from 'vitest'
import { hashUnitInterval, assignHoldout } from './holdout'

describe('hashUnitInterval', () => {
  it('is deterministic and in [0,1)', () => {
    const a = hashUnitInterval('thread_1')
    expect(a).toBe(hashUnitInterval('thread_1')) // stable
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    expect(hashUnitInterval('thread_1')).not.toBe(hashUnitInterval('thread_2'))
  })
})

describe('assignHoldout', () => {
  it('uses threadId when present, else runId; same thread → same assignment', () => {
    const t = assignHoldout('thread_x', 'run_a')
    expect(assignHoldout('thread_x', 'run_b')).toBe(t) // retry stability: thread wins
    // thread-less falls back to runId
    const r = assignHoldout(null, 'run_solo')
    expect(assignHoldout(null, 'run_solo')).toBe(r)
  })
})
