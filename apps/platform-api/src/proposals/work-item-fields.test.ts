import { describe, expect, it } from 'vitest'

import {
  UNDOABLE_FIELDS,
  conflictingFields,
  fieldSnapshot,
  normalizeFieldValue,
  undoableKeys,
} from './work-item-fields'

/**
 * These helpers are shared by all three points where a proposal touches a work item:
 * the DRAFT-time snapshot (`repository.ts`), the accept-time staleness fence + pre-image
 * (`apply.ts`), and the undo (`undo.ts`). They must agree, because a snapshot taken one
 * way and compared another way is a false conflict — or worse, a missed one.
 */
describe('undoableKeys', () => {
  it('keeps only real patchable columns, and ignores everything else', () => {
    expect(undoableKeys({ title: 'a', priority: 'high', nonsense: 1 })).toEqual([
      'title',
      'priority',
    ])
    // `depth` is server-derived from parent_id, never a caller patch.
    expect(undoableKeys({ depth: 3 })).toEqual([])
  })

  it('returns [] for a non-object payload instead of throwing', () => {
    // A human-edited payload can be anything; a bad shape must decline, not crash.
    for (const payload of [null, undefined, [], 'x', 7]) {
      expect(undoableKeys(payload)).toEqual([])
    }
  })

  it('orders keys by the canonical field list, not by payload key order', () => {
    // Draft-time and accept-time payloads may enumerate keys differently; a stable
    // order keeps the persisted snapshot comparable.
    expect(undoableKeys({ priority: 'high', title: 'a' })).toEqual(['title', 'priority'])
    expect(UNDOABLE_FIELDS.indexOf('title')).toBeLessThan(UNDOABLE_FIELDS.indexOf('priority'))
  })
})

describe('normalizeFieldValue', () => {
  it('collapses a Date to its ISO string (a live read vs a jsonb round-trip)', () => {
    // Without this, every comparison for an item with a due date false-conflicts.
    expect(normalizeFieldValue(new Date('2026-07-26T00:00:00.000Z'))).toBe(
      '2026-07-26T00:00:00.000Z',
    )
  })

  it('turns undefined into null (jsonb DROPS undefined keys)', () => {
    expect(normalizeFieldValue(undefined)).toBeNull()
  })

  it('normalizes array members too', () => {
    expect(normalizeFieldValue([undefined, 'a'])).toEqual([null, 'a'])
  })
})

describe('fieldSnapshot', () => {
  it('reads exactly the requested fields, recording an absent column as null', () => {
    const row = { title: 'A', priority: 'high', extra: 'ignored' }
    expect(fieldSnapshot(row, ['title', 'assignee_id'])).toEqual({
      title: 'A',
      assignee_id: null,
    })
  })
})

describe('conflictingFields', () => {
  it('names the fields whose current value moved away from the expected one', () => {
    expect(
      conflictingFields(
        { title: 'Seed item (pre-existing)', phase: 'plan' },
        { title: 'UXAUDIT-TMP stale-probe', phase: 'plan' },
      ),
    ).toEqual(['title'])
  })

  it('is empty when nothing the decision was made against has moved', () => {
    expect(conflictingFields({ phase: 'plan' }, { phase: 'plan', title: 'anything' })).toEqual([])
  })

  it('compares structurally, so an equal Date and ISO string do NOT conflict', () => {
    expect(
      conflictingFields(
        { due_date: '2026-07-26T00:00:00.000Z' },
        { due_date: new Date('2026-07-26T00:00:00.000Z') },
      ),
    ).toEqual([])
  })

  it('treats null and an absent column as the same (both are "no value")', () => {
    expect(conflictingFields({ assignee_id: null }, {})).toEqual([])
  })

  it('detects a real array change and ignores an equal one', () => {
    expect(conflictingFields({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([])
    expect(conflictingFields({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })).toEqual(['tags'])
  })
})
