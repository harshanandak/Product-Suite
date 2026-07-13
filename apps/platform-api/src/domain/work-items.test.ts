import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { createWorkItem, updateWorkItem } from './work-items'

const actor = { actorType: 'human', actorId: 'u_1' } as const

const WI_ROW = {
  id: 'wi_1',
  title: 'A',
  description: null,
  phase: 'plan',
  type: 'feature',
  priority: 'medium',
  tags: [],
  source: 'manual',
  project_id: null,
  team_id: 'team_1',
  status_id: 'status_1',
  parent_id: null,
  depth: 0,
  department: 'Eng',
  assignee_id: null,
  due_date: null,
  archived: false,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

describe('createWorkItem', () => {
  it('rejects a team not in the caller tenant with DomainError unknown_team', async () => {
    const sql = vi.fn(async () => []) as unknown as Sql // ownedTeam check → []
    await expect(
      createWorkItem(sql, { tenantId: 't_1', actor }, { team_id: 'team_x', status_id: 's_1' }),
    ).rejects.toMatchObject({ code: 'unknown_team' })
  })

  it('rejects a missing status_id with DomainError unknown_status', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ n: 1 }]) // team owned
    await expect(
      createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, { team_id: 'team_1' }),
    ).rejects.toMatchObject({ code: 'unknown_status' })
  })

  it('rejects a parent already nested (depth cap) with DomainError max_depth', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ n: 1 }]) // team owned
      .mockResolvedValueOnce([{ n: 1 }]) // status owned
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: 'wi_grand' }]) // parent is itself a child
    await expect(
      createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, {
        team_id: 'team_1',
        status_id: 'status_1',
        parent_id: 'wi_parent',
      }),
    ).rejects.toMatchObject({ code: 'max_depth' })
  })

  it('writes the item + created event via one batch and resolves a lazy actor after validation', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ n: 1 }]) // team owned
      .mockResolvedValueOnce([{ n: 1 }]) // status owned
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockResolvedValue([[WI_ROW], [{}]])
    // Lazy actor: resolved only after the two validation reads have run.
    const resolveActor = vi.fn(async () => actor)

    const created = await createWorkItem(
      sql as unknown as Sql,
      { tenantId: 't_1', actor: resolveActor },
      { title: 'A', team_id: 'team_1', status_id: 'status_1' },
    )
    expect(created.id).toBe('wi_1')
    // The actor thunk ran once, AFTER both ownership reads — preserving query order.
    expect(resolveActor).toHaveBeenCalledTimes(1)
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('idempotent re-drive: a unique violation on applied_from_proposal_id returns the existing row', async () => {
    const EXISTING = { ...WI_ROW, id: 'wi_existing' }
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ n: 1 }]) // team owned
      .mockResolvedValueOnce([{ n: 1 }]) // status owned
      .mockResolvedValueOnce([EXISTING]) // select by applied_from_proposal_id (idempotent fetch)
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'duplicate key value violates unique constraint "work_items_applied_from_proposal_uniq"',
        ),
      )

    const created = await createWorkItem(
      sql as unknown as Sql,
      { tenantId: 't_1', actor, appliedFromProposalId: 'p1' },
      { title: 'A', team_id: 'team_1', status_id: 'status_1' },
    )
    // The re-drive returns the row a prior apply attempt already wrote — no error,
    // no second create (the apply is exactly-once).
    expect(created.id).toBe('wi_existing')
  })
})

describe('updateWorkItem', () => {
  it('throws DomainError not_found for an item outside the caller orgs', async () => {
    const sql = vi.fn(async () => []) as unknown as Sql // scoped select → []
    await expect(
      updateWorkItem(sql, { tenantIds: ['t_1'], actor }, 'wi_x', { phase: 'done' }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('throws DomainError cycle when the reparent guard blocks (update returns no row after a set)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([WI_ROW]) // scoped select
      .mockResolvedValueOnce([]) // child-check: no children
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: null }]) // parent lookup
      .mockResolvedValueOnce([]) // guarded UPDATE returns 0 rows (cycle blocked)
    await expect(
      updateWorkItem(sql as unknown as Sql, { tenantIds: ['t_1'], actor }, 'wi_1', { parent_id: 'wi_anc' }),
    ).rejects.toMatchObject({ code: 'cycle' })
  })

  it('rejects a self-parent with DomainError self_parent (no parent lookup)', async () => {
    const sql = vi.fn()
    sql.mockResolvedValueOnce([WI_ROW]) // scoped select
    await expect(
      updateWorkItem(sql as unknown as Sql, { tenantIds: ['t_1'], actor }, 'wi_1', { parent_id: 'wi_1' }),
    ).rejects.toMatchObject({ code: 'self_parent' })
    expect(sql).toHaveBeenCalledTimes(1)
  })

  it('updates an owned item and stamps the resolved actor inline', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([WI_ROW]) // scoped select
      .mockResolvedValueOnce([{ ...WI_ROW, phase: 'done' }]) // guarded UPDATE returns the row
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn().mockResolvedValueOnce([{}]) // activity insert
    const resolveActor = vi.fn(async () => actor)

    const updated = await updateWorkItem(
      sql as unknown as Sql,
      { tenantIds: ['t_1'], actor: resolveActor },
      'wi_1',
      { phase: 'done' },
    )
    expect(updated.phase).toBe('done')
    expect(resolveActor).toHaveBeenCalledTimes(1)
  })
})
