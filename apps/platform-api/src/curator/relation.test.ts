import { describe, expect, it } from 'vitest'

import type { CuratorCandidate } from './quality'
import {
  classifyRelation,
  DUPLICATE_THRESHOLD,
  OVERLAP_THRESHOLD,
  scopeCollides,
  similarity,
  type ExistingMemory,
} from './relation'

/**
 * RELATION-TO-EXISTING: the second half of SAP's Global Curator — does this candidate
 * duplicate, overlap with, or conflict with a memory already in the store?
 *
 * The load-bearing requirement is that a firing check NAMES the specific colliding
 * memory. "This overlaps with something" is not reviewable; "this overlaps with
 * <id> — <title>" is.
 */
function candidate(over: Partial<CuratorCandidate> = {}): CuratorCandidate {
  return {
    kind: 'fact',
    title: 'Pricing pages ship through the growth review',
    body: 'The growth lead signs off before a pricing page goes live.',
    topics: [],
    appliesWhen: null,
    scopeType: 'org',
    scopeId: null,
    ...over,
  }
}

function existing(over: Partial<ExistingMemory> = {}): ExistingMemory {
  return {
    id: 'm_existing',
    title: 'Pricing pages ship through the growth review',
    body: 'The growth lead signs off before any pricing page goes live.',
    kind: 'fact',
    visibility: 'org',
    scope_type: 'org',
    scope_id: null,
    ...over,
  }
}

describe('similarity (token Dice)', () => {
  it('is 1 for the same text and 0 for texts sharing nothing', () => {
    expect(similarity('release on friday', 'release on friday')).toBe(1)
    expect(similarity('release on friday', 'invoices paid quarterly')).toBe(0)
  })

  it('is symmetric and bounded to 0..1', () => {
    const a = 'pricing page needs growth sign off'
    const b = 'growth reviews the pricing roadmap'
    expect(similarity(a, b)).toBe(similarity(b, a))
    expect(similarity(a, b)).toBeGreaterThan(0)
    expect(similarity(a, b)).toBeLessThan(1)
  })

  it('ignores stopwords so function words cannot manufacture similarity', () => {
    expect(similarity('the and of to a', 'the and of to a')).toBe(0)
  })
})

describe('classifyRelation — duplicate', () => {
  it('reports a near-identical memory as a duplicate, naming id and title', () => {
    const collision = classifyRelation(candidate(), existing())
    expect(collision).not.toBeNull()
    expect(collision!.relation).toBe('duplicate')
    expect(collision!.memory_id).toBe('m_existing')
    expect(collision!.title).toBe('Pricing pages ship through the growth review')
    expect(collision!.reason).toContain('Pricing pages ship through the growth review')
    expect(collision!.similarity).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD)
  })
})

describe('classifyRelation — overlap', () => {
  it('reports a partially-overlapping memory as overlap, naming it', () => {
    const collision = classifyRelation(
      candidate(),
      existing({
        id: 'm_overlap',
        body: 'The growth lead reviews the quarterly pricing experiment backlog and the roadmap.',
      }),
    )
    expect(collision).not.toBeNull()
    expect(collision!.relation).toBe('overlap')
    expect(collision!.memory_id).toBe('m_overlap')
    expect(collision!.reason).toContain('m_overlap')
    expect(collision!.similarity).toBeGreaterThanOrEqual(OVERLAP_THRESHOLD)
    expect(collision!.similarity).toBeLessThan(DUPLICATE_THRESHOLD)
  })

  it('reports NO collision for an unrelated memory', () => {
    expect(
      classifyRelation(
        candidate(),
        existing({
          id: 'm_unrelated',
          title: 'Invoices are paid on net 30',
          body: 'Finance pays supplier invoices thirty days after receipt.',
        }),
      ),
    ).toBeNull()
  })
})

describe('classifyRelation — conflict', () => {
  it('reports a negation asymmetry as a CONFLICT, not a duplicate', () => {
    // Only one word separates these two texts, so token overlap alone reads as a
    // near-duplicate. The single most dangerous case in the system — a contradiction
    // entering memory — must not be reported as the most benign one.
    const collision = classifyRelation(
      candidate({
        kind: 'rule',
        title: 'Friday releases are allowed with a sign-off',
        body: 'Teams may release on Friday when the on-call engineer signs off.',
      }),
      existing({
        id: 'm_friday',
        title: 'Friday releases are not allowed',
        body: 'Teams must never release on Friday.',
      }),
    )
    expect(collision).not.toBeNull()
    expect(collision!.relation).toBe('conflict')
    expect(collision!.memory_id).toBe('m_friday')
    expect(collision!.reason).toContain('Friday releases are not allowed')
  })

  it('reports a numeric divergence as a conflict, naming BOTH numbers', () => {
    // SAP's own worked example: an SOP allowing deviations below EUR 250 against a
    // plant-specific policy with a lower threshold.
    const collision = classifyRelation(
      candidate({
        kind: 'rule',
        title: 'Deviations below 250 euro need no approval',
        body: 'When a purchase deviation is below 250 euro it is auto-approved.',
      }),
      existing({
        id: 'm_threshold',
        title: 'Deviations below 100 euro need no approval',
        body: 'When a purchase deviation is below 100 euro it is auto-approved.',
      }),
    )
    expect(collision).not.toBeNull()
    expect(collision!.relation).toBe('conflict')
    expect(collision!.reason).toContain('250')
    expect(collision!.reason).toContain('100')
  })

  it('does not call matching numbers a conflict', () => {
    const collision = classifyRelation(
      candidate({
        kind: 'rule',
        title: 'Deviations below 250 euro need no approval',
        body: 'When a purchase deviation is below 250 euro it is auto-approved.',
      }),
      existing({
        id: 'm_same',
        title: 'Deviations below 250 euro need no approval',
        body: 'When a purchase deviation is below 250 euro it is auto-approved.',
      }),
    )
    expect(collision!.relation).toBe('duplicate')
  })

  it('does not report a conflict for texts that are not about the same thing', () => {
    // A "never" somewhere unrelated in the store is not a contradiction.
    expect(
      classifyRelation(
        candidate(),
        existing({
          id: 'm_far',
          title: 'Invoices are never paid early',
          body: 'Finance must never pay a supplier invoice before its due date.',
        }),
      ),
    ).toBeNull()
  })
})

describe('classifyRelation — carries the colliding memory’s own facts', () => {
  it('reports the collider’s visibility and scope so the reviewer knows what it is', () => {
    const collision = classifyRelation(
      candidate(),
      existing({ id: 'm_mine', visibility: 'private', scope_type: 'project', scope_id: 'p_1' }),
    )
    expect(collision).toMatchObject({
      memory_id: 'm_mine',
      visibility: 'private',
      scope_type: 'project',
    })
  })

  it('gives every collision a human-readable reason, never a bare score', () => {
    const collision = classifyRelation(candidate(), existing())!
    expect(collision.reason.length).toBeGreaterThan(20)
    expect(collision.reason).not.toBe(String(collision.similarity))
  })
})

describe('scopeCollides', () => {
  const at = (scopeType: CuratorCandidate['scopeType'], scopeId: string | null) => ({ scopeType, scopeId })
  const row = (scope_type: ExistingMemory['scope_type'], scope_id: string | null) => ({ scope_type, scope_id })

  it('collides when the existing memory is org-scoped (org policy binds everywhere)', () => {
    expect(scopeCollides(at('work_item', 'wi_1'), row('org', null))).toBe(true)
  })

  it('collides when the CANDIDATE is org-scoped (it would bind over everything narrower)', () => {
    expect(scopeCollides(at('org', null), row('project', 'p_1'))).toBe(true)
  })

  it('collides on an identical narrow scope', () => {
    expect(scopeCollides(at('project', 'p_1'), row('project', 'p_1'))).toBe(true)
  })

  it('does NOT collide across two different narrow scopes', () => {
    // Containment cannot be proven without the object graph, and a false collision
    // trains reviewers to ignore the panel.
    expect(scopeCollides(at('project', 'p_1'), row('project', 'p_2'))).toBe(false)
    expect(scopeCollides(at('project', 'p_1'), row('work_item', 'wi_1'))).toBe(false)
  })
})
