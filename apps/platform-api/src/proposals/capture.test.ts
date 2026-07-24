import { describe, expect, it } from 'vitest'

import { UNDO_KEY } from './undo'
import { buildCaptureInput, shouldCapture, summarizeChange } from './capture'

const TARGET = '44444444-4444-4444-8444-444444444444'
const RUN = '55555555-5555-4555-8555-555555555555'

function proposal(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    tenant_id: 't_1',
    run_id: RUN,
    target_type: 'work_item',
    target_id: TARGET,
    operation: 'update',
    rationale: 'Ship the smaller surface first so the write path stays reviewable.',
    edited_payload: null,
    ...over,
  } as Parameters<typeof shouldCapture>[0]
}

/** An applied_write carrying the undo envelope an update stamps. */
const ENVELOPE = {
  id: TARGET,
  title: 'B',
  [UNDO_KEY]: { pre_image: { title: 'A', priority: 'low' }, applied: { title: 'B', priority: 'high' } },
}

describe('shouldCapture', () => {
  it('captures an accept that carries a rationale', () => {
    expect(shouldCapture(proposal())).toBe(true)
  })

  it('captures an accept the reviewer EDITED, even with no rationale', () => {
    // The edit is human signal in its own right — the reviewer disagreed with the
    // agent and said so in the payload rather than in words.
    expect(shouldCapture(proposal({ rationale: null, edited_payload: { title: 'C' } }))).toBe(true)
  })

  it('does NOT capture a bare accept — no rationale, no edit', () => {
    // Such a memory would restate the proposals row and nothing more. That is the
    // landfill that makes a memory store useless six months in.
    expect(shouldCapture(proposal({ rationale: null, edited_payload: null }))).toBe(false)
    expect(shouldCapture(proposal({ rationale: '   ', edited_payload: null }))).toBe(false)
  })

  it('does NOT capture a memory-type proposal — it already IS a memory', () => {
    expect(shouldCapture(proposal({ target_type: 'memory' }))).toBe(false)
  })
})

describe('summarizeChange', () => {
  it('renders each changed field as pre-image -> applied', () => {
    expect(summarizeChange(ENVELOPE)).toEqual([
      'priority: low -> high',
      'title: A -> B',
    ])
  })

  it('returns nothing when there is no undo envelope (a create has no pre-image)', () => {
    expect(summarizeChange({ id: TARGET, title: 'B' })).toEqual([])
    expect(summarizeChange(null)).toEqual([])
  })

  it('renders an absent previous value as (none) rather than null', () => {
    expect(
      summarizeChange({ [UNDO_KEY]: { pre_image: { assignee_id: null }, applied: { assignee_id: 'u_1' } } }),
    ).toEqual(['assignee_id: (none) -> u_1'])
  })
})

describe('buildCaptureInput', () => {
  it('records a DECISION — never a rule or a fact', () => {
    // A single accept does not establish a truth (fact) and must not mint policy
    // (rule); rules are the reflection layer's output, not one human click.
    const input = buildCaptureInput(proposal(), { id: TARGET, title: 'B' }, ENVELOPE, 'u_approver')
    expect(input?.kind).toBe('decision')
  })

  it('titles from the rationale first sentence', () => {
    const input = buildCaptureInput(proposal(), { id: TARGET, title: 'B' }, ENVELOPE, 'u_approver')
    expect(input?.title).toBe('Ship the smaller surface first so the write path stays reviewable.')
  })

  it('falls back to a field summary when the accept was edited but unexplained', () => {
    const input = buildCaptureInput(
      proposal({ rationale: null, edited_payload: { title: 'C' } }),
      { id: TARGET, title: 'B' },
      ENVELOPE,
      'u_approver',
    )
    expect(input?.title).toContain('priority')
    expect(input?.title).toContain('title')
  })

  it('body carries the concrete change, which the proposals row does not hold queryably', () => {
    const input = buildCaptureInput(proposal(), { id: TARGET, title: 'B' }, ENVELOPE, 'u_approver')
    expect(input?.body).toContain('title: A -> B')
    expect(input?.body).toContain('priority: low -> high')
  })

  it('body notes when the reviewer edited before accepting', () => {
    const input = buildCaptureInput(
      proposal({ edited_payload: { title: 'C' } }),
      { id: TARGET, title: 'B' },
      ENVELOPE,
      'u_approver',
    )
    expect(input?.body).toMatch(/edited/i)
  })

  it('scopes to the work item, with the changed fields as topics', () => {
    const input = buildCaptureInput(proposal(), { id: TARGET, title: 'B' }, ENVELOPE, 'u_approver')
    expect(input?.scopeType).toBe('work_item')
    expect(input?.scopeId).toBe(TARGET)
    expect(input?.topics).toEqual(['priority', 'title'])
  })

  it('scopes a CREATE to the row it just made (a create has no target_id yet)', () => {
    const input = buildCaptureInput(
      proposal({ operation: 'create', target_id: null }),
      { id: 'wi_new', title: 'B' },
      { id: 'wi_new' },
      'u_approver',
    )
    expect(input?.scopeId).toBe('wi_new')
  })

  it('carries proposal provenance and the HUMAN approver as decider', () => {
    const input = buildCaptureInput(proposal(), { id: TARGET, title: 'B' }, ENVELOPE, 'u_approver')
    expect(input?.sourceKind).toBe('proposal')
    expect(input?.sourceProposalId).toBe('p1')
    expect(input?.sourceRunId).toBe(RUN)
    // The agent proposed it; a HUMAN decided it. Provenance must not blur that.
    expect(input?.decidedBy).toBe('u_approver')
  })

  it('returns null when the gate says this accept is not worth remembering', () => {
    expect(
      buildCaptureInput(
        proposal({ rationale: null, edited_payload: null }),
        { id: TARGET, title: 'B' },
        ENVELOPE,
        'u_approver',
      ),
    ).toBeNull()
  })
})

describe('title bounding', () => {
  const LIMIT = 160

  it('bounds a long rationale-derived title', () => {
    const input = buildCaptureInput(
      proposal({ rationale: `${'x'.repeat(400)}.` }),
      { id: TARGET, title: 'B' },
      ENVELOPE,
      'u_approver',
    )
    expect(input?.title.length).toBeLessThanOrEqual(LIMIT)
  })

  it('bounds the GENERATED fallback title too — it grows with the item title and field list', () => {
    // The fallback is built from the work item's title and every changed field,
    // so it can outrun the limit exactly like a long rationale can. Capture is
    // best-effort, so an over-length insert would be swallowed and the memory
    // lost with no error surfaced to anyone.
    const manyFields = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`field_${i}_with_a_long_name`, `v${i}`]),
    )
    const input = buildCaptureInput(
      proposal({ rationale: null, edited_payload: { title: 'C' } }),
      { id: TARGET, title: 'A very long work item title '.repeat(10) },
      { [UNDO_KEY]: { pre_image: manyFields, applied: manyFields } },
      'u_approver',
    )

    expect(input?.title.length).toBeLessThanOrEqual(LIMIT)
  })

  it('bounds a create fallback built from a very long item title', () => {
    const input = buildCaptureInput(
      proposal({ operation: 'create', target_id: null, rationale: null, edited_payload: { a: 1 } }),
      { id: 'wi_new', title: 'T'.repeat(500) },
      { id: 'wi_new' },
      'u_approver',
    )
    expect(input?.title.length).toBeLessThanOrEqual(LIMIT)
  })
})
