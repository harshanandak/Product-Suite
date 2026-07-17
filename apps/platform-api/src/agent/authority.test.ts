import { describe, expect, it } from 'vitest'
import { resolveTier, compareByAuthority, annotateByAuthority, ANNOTATE_SIM_THRESHOLD } from './authority'

describe('resolveTier', () => {
  it('orders pinned-hard-rule > active memory > work-item chunk', () => {
    expect(resolveTier({ kind: 'memory', memKind: 'rule', pinned: true, enforcement: 'hard' })).toBe(0)
    expect(resolveTier({ kind: 'memory', memKind: 'decision' })).toBe(1)
    expect(resolveTier({ kind: 'chunk', sourceType: 'work_item' })).toBe(3)
  })
  it('tier 0 is ONLY a pinned hard RULE — a pinned hard decision/fact falls through to tier 1', () => {
    expect(resolveTier({ kind: 'memory', memKind: 'rule', pinned: true, enforcement: 'hard' })).toBe(0)
    expect(resolveTier({ kind: 'memory', memKind: 'decision', pinned: true, enforcement: 'hard' })).toBe(1)
    expect(resolveTier({ kind: 'memory', memKind: 'fact', pinned: true, enforcement: 'hard' })).toBe(1)
  })
})
describe('compareByAuthority', () => {
  it('higher tier first; ties → scope specificity → event-time recency', () => {
    const t1 = { tier: 1, scopeType: 'org', eventTime: '2026-01-01' }
    const t3 = { tier: 3, scopeType: 'work_item', eventTime: '2026-07-01' }
    expect(compareByAuthority(t1 as any, t3 as any)).toBeLessThan(0) // t1 first
    const a = { tier: 3, scopeType: 'project', eventTime: '2026-01-01' }
    const b = { tier: 3, scopeType: 'org', eventTime: '2026-01-01' }
    expect(compareByAuthority(a as any, b as any)).toBeLessThan(0) // project (more specific) first
  })
})
describe('annotateByAuthority', () => {
  it('annotates a lower-tier chunk highly similar to a higher-tier memory', () => {
    const mem = { id: 'm1', tier: 1, kind: 'memory', title: 'Use Postgres', embedding: [1, 0, 0] }
    const chunk = { id: 'c1', tier: 3, kind: 'chunk', title: 'DB choice', embedding: [0.99, 0.14, 0] }
    const out = annotateByAuthority([chunk, mem] as any)
    const annotated = out.find((x) => x.id === 'c1')!
    expect(annotated.annotation).toMatch(/see decision: Use Postgres/)
    // the higher-tier memory ranks before the annotated chunk
    expect(out.findIndex((x) => x.id === 'm1')).toBeLessThan(out.findIndex((x) => x.id === 'c1'))
  })
  it('does NOT annotate below the threshold', () => {
    const mem = { id: 'm1', tier: 1, kind: 'memory', title: 'X', embedding: [1, 0, 0] }
    const chunk = { id: 'c1', tier: 3, kind: 'chunk', title: 'Y', embedding: [0, 1, 0] }
    expect(annotateByAuthority([chunk, mem] as any).find((x) => x.id === 'c1')!.annotation).toBeUndefined()
    expect(ANNOTATE_SIM_THRESHOLD).toBe(0.82)
  })
  it('does NOT annotate against a non-memory referent (a T4 meeting vs a T3 chunk stays unannotated)', () => {
    // The chunk (T3) is more authoritative than the meeting (T4) and highly similar,
    // but it is NOT a memory (tier > 1) so it must never be a "see decision:" referent.
    const chunk = { id: 'c1', tier: 3, kind: 'chunk', title: 'DB choice', embedding: [1, 0, 0] }
    const meeting = { id: 'x1', tier: 4, kind: 'chunk', title: 'Standup aside', embedding: [0.99, 0.14, 0] }
    const out = annotateByAuthority([meeting, chunk] as any)
    expect(out.find((x) => x.id === 'x1')!.annotation).toBeUndefined()
  })
  it('annotates a T1 memory that defers to a more-authoritative T0 pinned rule', () => {
    const rule = { id: 'r1', tier: 0, kind: 'memory', title: 'Always encrypt PII', embedding: [1, 0, 0] }
    const mem = { id: 'm1', tier: 1, kind: 'memory', title: 'Store SSNs', embedding: [0.99, 0.14, 0] }
    const out = annotateByAuthority([mem, rule] as any)
    expect(out.find((x) => x.id === 'm1')!.annotation).toMatch(/see decision: Always encrypt PII/)
  })
})
