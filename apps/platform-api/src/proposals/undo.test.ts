import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { DomainError } from '../domain/errors'
import {
  UNDOABLE_FIELDS,
  UNDO_KEY,
  buildUndoEnvelope,
  conflictingFields,
  fieldSnapshot,
  readUndoEnvelope,
  undoHttpStatus,
  undoProposal,
  undoableKeys,
} from './undo'

// The undo reversal goes through the SAME validated domain command the human UI and
// the accept path use — mocked here so each test controls its outcome and can assert
// the patch it received (the pre-image) and the HUMAN actor that carried it.
const { updateWorkItem } = vi.hoisted(() => ({ updateWorkItem: vi.fn() }))
vi.mock('../domain/work-items', () => ({ updateWorkItem }))

// Capture-on-accept means an undo may have a memory to retract. Mocked so each test
// controls whether one exists and what retracting it does.
const { getMemoryBySourceProposalId, retractMemory } = vi.hoisted(() => ({
  getMemoryBySourceProposalId: vi.fn(),
  retractMemory: vi.fn(),
}))
vi.mock('../domain/memories', () => ({ getMemoryBySourceProposalId, retractMemory }))

const TARGET = '44444444-4444-4444-8444-444444444444'
const TEAM_ID = '11111111-1111-4111-8111-111111111111'

/** The work item as it stands AFTER the accept applied `{ priority: 'high', title: 'B' }`. */
const CURRENT_ROW = {
  id: TARGET,
  title: 'B',
  description: 'd',
  phase: 'plan',
  type: 'feature',
  priority: 'high',
  tags: ['x'],
  project_id: null,
  team_id: TEAM_ID,
  status_id: '22222222-2222-4222-8222-222222222222',
  parent_id: null,
  depth: 0,
  department: 'Eng',
  assignee_id: null,
  due_date: null,
  archived: false,
}

const UNDO_ENVELOPE = {
  pre_image: { title: 'A', priority: 'low' },
  applied: { title: 'B', priority: 'high' },
}

const APPLIED_PROPOSAL = {
  id: 'p1',
  tenant_id: 't_1',
  run_id: 'run_1',
  target_type: 'work_item',
  target_id: TARGET,
  operation: 'update',
  payload: { title: 'B', priority: 'high' },
  edited_payload: null,
  status: 'applied' as string,
  applied_write: { ...CURRENT_ROW, [UNDO_KEY]: UNDO_ENVELOPE },
}

/**
 * A stateful `sql` mock. Reads route by statement text: the proposal load, the
 * target work-item read (the conflict check's CURRENT values), and the guarded
 * `applied_write` mark that stamps the undo. `getAppliedWrite()` exposes what the
 * mark persisted so a test can assert the undo record without a real DB.
 */
function makeSql(
  opts: {
    proposal?: Record<string, unknown> | null
    /** The target's CURRENT row (null ⇒ deleted/not in the caller's tenants). */
    current?: Record<string, unknown> | null
    /** When true the guarded mark matches no row (a concurrent undo won). */
    markLoses?: boolean
    /** The Postgres-side `to_jsonb(work_items)` rendering (defaults to `current`). */
    rowJson?: Record<string, unknown>
    /**
     * Successive answers to the target read, so a test can make the row DRIFT
     * between the pre-check and the post-fence re-read — the concurrent-editor
     * race the fence exists to catch. `null` entries mean the row was deleted.
     */
    currentSequence?: (Record<string, unknown> | null)[]
  } = {},
) {
  const proposal = opts.proposal === null ? null : { ...APPLIED_PROPOSAL, ...(opts.proposal ?? {}) }
  const current = opts.current === undefined ? CURRENT_ROW : opts.current
  let persistedAppliedWrite: unknown = proposal?.applied_write ?? null
  let targetReads = 0

  const query = vi.fn(async (text: string, params: unknown[]) => {
    if (text.includes('set applied_write')) {
      if (opts.markLoses) return []
      persistedAppliedWrite = JSON.parse(params[0] as string)
      return [{ id: 'p1' }]
    }
    return []
  })

  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings)
    if (text.includes('from proposals')) return proposal ? [proposal] : []
    // The target read returns the row AND its Postgres-side jsonb rendering, which
    // is what the compare-and-set fence is built from (identical formatting on both
    // sides of the containment check, so a timestamp can never false-conflict).
    if (text.includes('from work_items')) {
      if (opts.currentSequence) {
        const row = opts.currentSequence[Math.min(targetReads++, opts.currentSequence.length - 1)]
        return row ? [{ ...row, row_json: row }] : []
      }
      return current ? [{ ...current, row_json: opts.rowJson ?? current }] : []
    }
    return []
  }) as unknown as Sql
  ;(sql as unknown as { query: typeof query }).query = query

  return { sql, getAppliedWrite: () => persistedAppliedWrite, query }
}

const ctx = { tenantIds: ['t_1'], approverUserId: 'u_approver' }

describe('undo pre-image helpers', () => {
  it('undoableKeys keeps only patch keys that are real undoable columns', () => {
    expect(undoableKeys({ title: 'A', priority: 'low', bogus: 1, depth: 9 })).toEqual([
      'title',
      'priority',
    ])
  })

  it('UNDOABLE_FIELDS excludes server-derived depth (never a caller patch)', () => {
    expect(UNDOABLE_FIELDS).not.toContain('depth')
    expect(UNDOABLE_FIELDS).toContain('title')
  })

  it('fieldSnapshot reads exactly the named fields, normalizing Dates to ISO', () => {
    const snapshot = fieldSnapshot(
      { title: 'A', due_date: new Date('2026-07-01T00:00:00.000Z'), other: 'ignored' },
      ['title', 'due_date'],
    )
    expect(snapshot).toEqual({ title: 'A', due_date: '2026-07-01T00:00:00.000Z' })
  })

  it('fieldSnapshot records an absent column as null (never undefined — jsonb drops it)', () => {
    expect(fieldSnapshot({}, ['title'])).toEqual({ title: null })
  })

  it('buildUndoEnvelope nests the pre-image under the reserved key beside the row', () => {
    const stamped = buildUndoEnvelope(CURRENT_ROW, { title: 'A' }, { title: 'B' })
    // The row's own fields stay at the TOP level — existing applied_write readers are unaffected.
    expect(stamped.id).toBe(TARGET)
    expect(stamped[UNDO_KEY]).toEqual({ pre_image: { title: 'A' }, applied: { title: 'B' } })
  })

  it('readUndoEnvelope returns null for an applied_write with no pre-image (pre-undo accepts)', () => {
    expect(readUndoEnvelope({ id: TARGET })).toBeNull()
    expect(readUndoEnvelope(null)).toBeNull()
    expect(readUndoEnvelope({ [UNDO_KEY]: { applied: {} } })).toBeNull()
  })

  it('conflictingFields is empty when the current row still equals what the accept applied', () => {
    expect(conflictingFields({ title: 'B', priority: 'high' }, CURRENT_ROW)).toEqual([])
  })

  it('conflictingFields names every field a later edit moved', () => {
    expect(
      conflictingFields({ title: 'B', priority: 'high' }, { ...CURRENT_ROW, title: 'C' }),
    ).toEqual(['title'])
  })

  it('conflictingFields compares arrays and Dates structurally, not by reference', () => {
    expect(conflictingFields({ tags: ['x'] }, { tags: ['x'] })).toEqual([])
    expect(conflictingFields({ tags: ['x'] }, { tags: ['y'] })).toEqual(['tags'])
    expect(
      conflictingFields(
        { due_date: '2026-07-01T00:00:00.000Z' },
        { due_date: new Date('2026-07-01T00:00:00.000Z') },
      ),
    ).toEqual([])
  })
})

describe('undoHttpStatus', () => {
  it('maps each outcome to its HTTP code', () => {
    expect(undoHttpStatus({ status: 'undone', proposal_id: 'p1', item_id: TARGET })).toBe(200)
    expect(undoHttpStatus({ status: 'not_found', proposal_id: 'p1' })).toBe(404)
    expect(undoHttpStatus({ status: 'not_undoable', proposal_id: 'p1', message: 'x' })).toBe(422)
    expect(
      undoHttpStatus({ status: 'conflict', proposal_id: 'p1', message: 'x', fields: ['title'] }),
    ).toBe(409)
  })
})

describe('undoProposal', () => {
  beforeEach(() => {
    updateWorkItem.mockReset()
    updateWorkItem.mockResolvedValue({ ...CURRENT_ROW, title: 'A', priority: 'low' })
  })

  it('reverses the accept by writing the PRE-IMAGE through the validated domain command', async () => {
    const { sql } = makeSql()
    const result = await undoProposal(sql, ctx, 'p1')

    expect(result).toEqual({ status: 'undone', proposal_id: 'p1', item_id: TARGET })
    // The undo is a NEW validated write of the pre-image — never a status rollback.
    expect(updateWorkItem).toHaveBeenCalledTimes(1)
    const [firstCall] = updateWorkItem.mock.calls
    if (!firstCall) throw new Error('updateWorkItem was never called')
    const [, writeCtx, id, patch] = firstCall
    expect(id).toBe(TARGET)
    expect(patch).toEqual({ title: 'A', priority: 'low' })
    expect(writeCtx.tenantIds).toEqual(['t_1'])
  })

  it('carries the approver as the HUMAN actor (a human reversed it, not the agent)', async () => {
    const { sql } = makeSql()
    await undoProposal(sql, ctx, 'p1')
    const [firstCall] = updateWorkItem.mock.calls
    if (!firstCall) throw new Error('updateWorkItem was never called')
    const [, writeCtx] = firstCall
    expect(writeCtx.actor).toEqual({ actorType: 'human', actorId: 'u_approver' })
  })

  it('records the undo INSIDE applied_write (no new column, no status rollback)', async () => {
    const { sql, getAppliedWrite } = makeSql()
    await undoProposal(sql, ctx, 'p1')

    const persisted = getAppliedWrite() as Record<string, Record<string, unknown> | undefined>
    const undo = persisted[UNDO_KEY]
    if (!undo) throw new Error('applied_write is missing the undo envelope')
    expect(undo.undone_by).toBe('u_approver')
    expect(typeof undo.undone_at).toBe('string')
    // The pre-image/applied record survives so the undo is auditable after the fact.
    expect(undo.pre_image).toEqual({ title: 'A', priority: 'low' })
  })

  it('keeps the proposal `applied` — "accepted always means applied" still holds', async () => {
    const { sql, query } = makeSql()
    await undoProposal(sql, ctx, 'p1')
    const mark = query.mock.calls.find(([text]) => text.includes('set applied_write'))
    expect(mark?.[0]).not.toMatch(/set status/)
    // The mark is GUARDED on still-applied + not-yet-undone (a concurrent undo loses).
    expect(mark?.[0]).toContain("status = 'applied'")
    expect(mark?.[0]).toContain('undone_at')
  })

  it('409s and writes NOTHING when the item changed since the accept', async () => {
    const { sql } = makeSql({ current: { ...CURRENT_ROW, title: 'edited by a human' } })
    const result = await undoProposal(sql, ctx, 'p1')

    expect(result).toEqual({
      status: 'conflict',
      proposal_id: 'p1',
      message: expect.stringContaining('changed'),
      fields: ['title'],
    })
    // Never silently clobber a later edit.
    expect(updateWorkItem).not.toHaveBeenCalled()
  })

  it('409s when the proposal was already undone', async () => {
    const { sql } = makeSql({
      proposal: {
        applied_write: {
          ...CURRENT_ROW,
          [UNDO_KEY]: { ...UNDO_ENVELOPE, undone_at: '2026-07-20T00:00:00.000Z' },
        },
      },
    })
    const result = await undoProposal(sql, ctx, 'p1')
    expect(result.status).toBe('conflict')
    expect(updateWorkItem).not.toHaveBeenCalled()
  })

  it('409s when a concurrent undo won the guarded mark (the loser reports conflict)', async () => {
    const { sql } = makeSql({ markLoses: true })
    const result = await undoProposal(sql, ctx, 'p1')
    expect(result.status).toBe('conflict')
  })

  it('404s for a proposal outside the caller’s tenants', async () => {
    const { sql } = makeSql({ proposal: null })
    expect(await undoProposal(sql, ctx, 'p1')).toEqual({ status: 'not_found', proposal_id: 'p1' })
    expect(updateWorkItem).not.toHaveBeenCalled()
  })

  it('404s when the target item no longer exists', async () => {
    const { sql } = makeSql({ current: null })
    expect((await undoProposal(sql, ctx, 'p1')).status).toBe('not_found')
    expect(updateWorkItem).not.toHaveBeenCalled()
  })

  it('refuses a proposal that is not `applied`', async () => {
    const { sql } = makeSql({ proposal: { status: 'pending' } })
    const result = await undoProposal(sql, ctx, 'p1')
    expect(result.status).toBe('conflict')
    expect(updateWorkItem).not.toHaveBeenCalled()
  })

  it('refuses a create (undoing a create is a delete — deliberately out of scope)', async () => {
    const { sql } = makeSql({ proposal: { operation: 'create', target_id: null } })
    const result = await undoProposal(sql, ctx, 'p1')
    expect(result.status).toBe('not_undoable')
    expect(updateWorkItem).not.toHaveBeenCalled()
  })

  it('refuses a memory proposal (supersede/retract already carry reversal semantics)', async () => {
    const { sql } = makeSql({ proposal: { target_type: 'memory', operation: 'supersede' } })
    expect((await undoProposal(sql, ctx, 'p1')).status).toBe('not_undoable')
  })

  it('refuses an accept that predates pre-image capture (nothing to restore)', async () => {
    const { sql } = makeSql({ proposal: { applied_write: { ...CURRENT_ROW } } })
    const result = await undoProposal(sql, ctx, 'p1')
    expect(result).toEqual({
      status: 'not_undoable',
      proposal_id: 'p1',
      message: expect.stringContaining('before'),
    })
  })

  it('maps a domain rejection of the reversal to a legible outcome (never a raw 500)', async () => {
    const { sql } = makeSql()
    updateWorkItem.mockRejectedValue(new DomainError('unknown_status', 'Unknown status'))
    const result = await undoProposal(sql, ctx, 'p1')
    expect(result).toEqual({
      status: 'not_undoable',
      proposal_id: 'p1',
      message: 'Unknown status',
    })
  })

  it('rethrows an unexpected error so the route reports a genuine 500', async () => {
    const { sql } = makeSql()
    updateWorkItem.mockRejectedValue(new Error('connection reset'))
    await expect(undoProposal(sql, ctx, 'p1')).rejects.toThrow('connection reset')
  })

  /**
   * The drift check alone is a check-then-write: a concurrent editor landing between
   * the read and the restore would be silently clobbered — the exact harm the 409
   * exists to prevent. So the values observed during the check are carried into the
   * restore as a compare-and-set fence, evaluated inside the writing statement.
   */
  describe('atomic compare-and-set', () => {
    it('fences the restore with the exact row state the check validated against', async () => {
      const { sql } = makeSql()
      await undoProposal(sql, ctx, 'p1')

      const [, writeCtx] = updateWorkItem.mock.calls[0] ?? []
      // Only the fields the accept applied are fenced — an unrelated concurrent edit
      // (a comment, a due date the accept never touched) must not block a valid undo.
      expect(writeCtx.expectedValues).toEqual({ title: 'B', priority: 'high' })
    })

    it('builds the fence from the DB-side jsonb rendering, not the JS row', async () => {
      // Postgres renders a timestamptz differently from JS `toISOString()`. Fencing on
      // the row_json the DB itself produced makes the containment check exact.
      const { sql } = makeSql({
        proposal: {
          applied_write: {
            ...CURRENT_ROW,
            [UNDO_KEY]: {
              pre_image: { due_date: null },
              applied: { due_date: '2026-07-01T00:00:00.000Z' },
            },
          },
        },
        current: { ...CURRENT_ROW, due_date: new Date('2026-07-01T00:00:00.000Z') },
        rowJson: { ...CURRENT_ROW, due_date: '2026-07-01T00:00:00+00:00' },
      })
      await undoProposal(sql, ctx, 'p1')

      const [, writeCtx] = updateWorkItem.mock.calls[0] ?? []
      expect(writeCtx.expectedValues).toEqual({ due_date: '2026-07-01T00:00:00+00:00' })
    })

    it('reports a conflict when the fence loses the race (guard_failed, nothing written)', async () => {
      const { sql, query } = makeSql()
      updateWorkItem.mockRejectedValue(
        new DomainError('guard_failed', 'the item changed while this write was being applied'),
      )
      const result = await undoProposal(sql, ctx, 'p1')

      expect(result.status).toBe('conflict')
      if (result.status === 'conflict') {
        expect(result.message).toMatch(/changed/)
      }
      // A lost fence wrote nothing, so the proposal is NOT marked undone — the undo
      // stays available once the reviewer re-reads.
      expect(query.mock.calls.filter(([text]) => text.includes('set applied_write'))).toHaveLength(0)
    })

    it('names the drifted fields on a lost fence by re-reading the target', async () => {
      // The pre-check passed against the row we read; by the time the fenced write
      // ran, someone had moved `title`. Re-read so the reviewer is told WHAT changed.
      const { sql } = makeSql({
        currentSequence: [CURRENT_ROW, { ...CURRENT_ROW, title: 'moved' }],
      })
      updateWorkItem.mockRejectedValue(new DomainError('guard_failed', 'lost the fence'))

      const result = await undoProposal(sql, ctx, 'p1')
      expect(result).toMatchObject({ status: 'conflict', fields: ['title'] })
    })

    it('reports not_found when the fence lost because the item was deleted', async () => {
      const { sql } = makeSql({ currentSequence: [CURRENT_ROW, null] })
      updateWorkItem.mockRejectedValue(new DomainError('guard_failed', 'lost the fence'))

      expect((await undoProposal(sql, ctx, 'p1')).status).toBe('not_found')
    })
  })
})

/**
 * An undo reverses a decision, so the memory that decision left behind must stop
 * being retrieved — an active memory describing a reversed choice is worse than
 * no memory at all.
 */
describe('undoProposal — the captured memory', () => {
  beforeEach(() => {
    updateWorkItem.mockReset().mockResolvedValue({ ...CURRENT_ROW, title: 'A', priority: 'low' })
    getMemoryBySourceProposalId.mockReset().mockResolvedValue(null)
    retractMemory.mockReset().mockResolvedValue({ id: 'mem_1', status: 'retracted' })
  })

  it('RETRACTS the memory the accept captured', async () => {
    // Retract, not supersede: superseding demands a change_reason and mints a new
    // ACTIVE row whose content is a non-decision — pollution with extra steps.
    getMemoryBySourceProposalId.mockResolvedValue({ id: 'mem_1', status: 'active' })
    const { sql } = makeSql()

    const result = await undoProposal(sql, ctx, 'p1')

    expect(result.status).toBe('undone')
    expect(retractMemory).toHaveBeenCalledTimes(1)
    const [, retractCtx, id] = retractMemory.mock.calls[0] ?? []
    expect(id).toBe('mem_1')
    expect(retractCtx.actor).toBe('u_approver')
  })

  it('leaves an already-retracted memory alone', async () => {
    getMemoryBySourceProposalId.mockResolvedValue({ id: 'mem_1', status: 'retracted' })
    const { sql } = makeSql()

    await undoProposal(sql, ctx, 'p1')

    expect(retractMemory).not.toHaveBeenCalled()
  })

  it('still reports the undo as DONE when retracting fails', async () => {
    // The item has already been restored. Failing the undo over a secondary record
    // would tell the reader their change was not reversed, which is false.
    getMemoryBySourceProposalId.mockResolvedValue({ id: 'mem_1', status: 'active' })
    retractMemory.mockRejectedValueOnce(new Error('conflict'))
    const { sql } = makeSql()

    const result = await undoProposal(sql, ctx, 'p1')

    expect(result.status).toBe('undone')
  })

  it('does nothing when the accept captured no memory', async () => {
    const { sql } = makeSql()
    const result = await undoProposal(sql, ctx, 'p1')
    expect(result.status).toBe('undone')
    expect(retractMemory).not.toHaveBeenCalled()
  })
})
