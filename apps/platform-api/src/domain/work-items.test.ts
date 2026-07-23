import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { createWorkItem, resolveDefaultStatusId, resolveDefaultTeamId, updateWorkItem } from './work-items'

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

  it('rejects a status_id that is not the team’s with DomainError unknown_status', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ n: 1 }]) // team owned
      .mockResolvedValueOnce([]) // status belongs-to-team check → not this team's
    await expect(
      createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, {
        team_id: 'team_1',
        status_id: 'status_other',
      }),
    ).rejects.toMatchObject({ code: 'unknown_status' })
  })

  it('resolves the team default status when status_id is omitted', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ n: 1 }]) // team owned
      .mockResolvedValueOnce([{ id: 'status_default' }]) // team default status lookup
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockResolvedValue([[{ ...WI_ROW, status_id: 'status_default' }], [{}]])
    const created = await createWorkItem(
      sql as unknown as Sql,
      { tenantId: 't_1', actor },
      { title: 'A', team_id: 'team_1' },
    )
    expect(created.status_id).toBe('status_default')
    // The default resolution ran in place of a status-ownership check (2 reads, no 400).
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('rejects a create with no status_id when the team has no statuses (no_default_status)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ n: 1 }]) // team owned
      .mockResolvedValueOnce([]) // team default status lookup → none
    await expect(
      createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, { team_id: 'team_1' }),
    ).rejects.toMatchObject({ code: 'no_default_status' })
  })

  it('resolves the caller’s sole team (and its default status) when team_id is omitted', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ id: 'team_solo' }]) // resolveDefaultTeamId: tenant has exactly one team
      .mockResolvedValueOnce([{ id: 'status_default' }]) // that team's default status
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockResolvedValue([[{ ...WI_ROW, team_id: 'team_solo', status_id: 'status_default' }], [{}]])
    const created = await createWorkItem(
      sql as unknown as Sql,
      { tenantId: 't_1', actor },
      { title: 'A' },
    )
    expect(created.team_id).toBe('team_solo')
    expect(created.status_id).toBe('status_default')
    // Team DERIVED from the tenant, then its default status — no team-ownership check (2 reads).
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('rejects a create with no team_id when the tenant has multiple teams (team_required_multiple)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ id: 'team_1' }, { id: 'team_2' }]) // ambiguous tenant
    await expect(
      createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, { title: 'A' }),
    ).rejects.toMatchObject({ code: 'team_required_multiple' })
  })

  it('rejects a create with no team_id when the tenant has zero teams (no_team)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]) // tenant has no team to create into
    await expect(
      createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, { title: 'A' }),
    ).rejects.toMatchObject({ code: 'no_team' })
  })

  it('rejects a provided blank OR non-string team_id (empty/whitespace/null/number/object) as unknown_team BEFORE any query', async () => {
    // Only an ABSENT key defaults; any PROVIDED bad value must reject cleanly. The
    // route body is untyped JSON, so the value can be a blank string OR a non-string
    // (number/object/null). The guard checks the TYPE before trimming, so a
    // non-string never TypeErrors on `.trim()` (→ 500) and a blank never reaches the
    // uuid column (→ Postgres 22P02/500). Every case must be a clean DomainError.
    for (const bad of ['', '   ', null, 123, { nested: true }]) {
      const sql = vi.fn() // must never be called — guard rejects pre-query
      await expect(
        createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, {
          title: 'A',
          team_id: bad as unknown as string,
        }),
      ).rejects.toMatchObject({ code: 'unknown_team' }) // a DomainError, never a TypeError/500
      expect(sql).not.toHaveBeenCalled() // no uuid query ran, no defaulting
    }
  })

  it('rejects a provided blank OR non-string status_id (empty/whitespace/null/number) as unknown_status BEFORE the status query', async () => {
    for (const bad of ['', '   ', null, 123]) {
      const sql = vi.fn().mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      await expect(
        createWorkItem(sql as unknown as Sql, { tenantId: 't_1', actor }, {
          title: 'A',
          team_id: 'team_1',
          status_id: bad as unknown as string,
        }),
      ).rejects.toMatchObject({ code: 'unknown_status' }) // a DomainError, never a TypeError/500
      // Only the team check ran (1 read); the bad status rejected before its own
      // uuid query — no 22P02/500, no resolveDefaultStatusId defaulting.
      expect(sql).toHaveBeenCalledTimes(1)
    }
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

describe('resolveDefaultStatusId', () => {
  it('picks the lowest-position non-triage status, scoped to the team', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ id: 'status_backlog' }])
    const id = await resolveDefaultStatusId(sql as unknown as Sql, 'team_1')
    expect(id).toBe('status_backlog')
    // The query excludes the reserved `triage` inbox and orders deterministically.
    const query = (sql.mock.calls[0]?.[0] as string[]).join('?')
    expect(query).toContain("category <> 'triage'")
    expect(query).toContain('order by position')
    expect(sql.mock.calls[0]?.slice(1)).toContain('team_1')
  })

  it('throws no_default_status when the team has no statuses', async () => {
    const sql = vi.fn().mockResolvedValueOnce([])
    await expect(resolveDefaultStatusId(sql as unknown as Sql, 'team_empty')).rejects.toMatchObject({
      code: 'no_default_status',
    })
  })
})

describe('resolveDefaultTeamId', () => {
  it('returns the tenant’s sole team, scoped to the tenant (reads one extra row to detect ambiguity)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ id: 'team_only' }])
    const id = await resolveDefaultTeamId(sql as unknown as Sql, 't_1')
    expect(id).toBe('team_only')
    // Scoped to the caller's tenant, and `limit 2` classifies none/one/many in one read.
    const query = (sql.mock.calls[0]?.[0] as string[]).join('?')
    expect(query).toContain('tenant_id')
    expect(query).toContain('limit 2')
    expect(sql.mock.calls[0]?.slice(1)).toContain('t_1')
  })

  it('throws team_required_multiple when the tenant has more than one team', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ id: 'team_1' }, { id: 'team_2' }])
    await expect(resolveDefaultTeamId(sql as unknown as Sql, 't_1')).rejects.toMatchObject({
      code: 'team_required_multiple',
    })
  })

  it('throws no_team when the tenant has no teams', async () => {
    const sql = vi.fn().mockResolvedValueOnce([])
    await expect(resolveDefaultTeamId(sql as unknown as Sql, 't_empty')).rejects.toMatchObject({
      code: 'no_team',
    })
  })
})

/**
 * `expectedValues` — the optional compare-and-set fence. A caller that already
 * validated a decision against a row it read (the undo path) can assert those
 * values INSIDE the update statement, so a concurrent writer landing between the
 * read and the write can never be silently overwritten. It is opt-in: every
 * existing caller omits it and is completely unaffected.
 */
describe('updateWorkItem — expectedValues fence', () => {
  /** The strings + params of the Nth tagged-template call. */
  function taggedCall(sql: ReturnType<typeof vi.fn>, index: number) {
    const [strings, ...params] = sql.mock.calls[index] ?? []
    return { text: (strings as string[]).join('?'), params }
  }

  it('asserts the expected values in the SAME statement that writes (no check-then-write gap)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([WI_ROW]) // scoped select
      .mockResolvedValueOnce([{ ...WI_ROW, title: 'restored' }]) // guarded UPDATE
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn().mockResolvedValueOnce([{}])

    await updateWorkItem(
      sql as unknown as Sql,
      { tenantIds: ['t_1'], actor, expectedValues: { title: 'A' } },
      'wi_1',
      { title: 'restored' },
    )

    const { text, params } = taggedCall(sql, 1)
    // A jsonb containment predicate on the OLD row — evaluated atomically with the write.
    expect(text).toContain('to_jsonb(work_items)')
    expect(text).toContain('@>')
    expect(params).toContain(JSON.stringify({ title: 'A' }))
  })

  it('binds NULL for a caller that supplies no fence, leaving the predicate inert', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([WI_ROW])
      .mockResolvedValueOnce([{ ...WI_ROW, phase: 'done' }])
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn().mockResolvedValueOnce([{}])

    await updateWorkItem(sql as unknown as Sql, { tenantIds: ['t_1'], actor }, 'wi_1', {
      phase: 'done',
    })

    const { text, params } = taggedCall(sql, 1)
    // The predicate is still present (one statement for every caller) but short-circuits
    // on a NULL fence, so unfenced callers behave exactly as before.
    expect(text).toMatch(/is null\s+or\s+to_jsonb\(work_items\)/)
    expect(params).toContain(null)
  })

  it('throws guard_failed — NOT a silent overwrite — when the fenced update matches nothing', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([WI_ROW]) // scoped select
      .mockResolvedValueOnce([]) // the fence no longer holds: 0 rows
    await expect(
      updateWorkItem(
        sql as unknown as Sql,
        { tenantIds: ['t_1'], actor, expectedValues: { title: 'A' } },
        'wi_1',
        { title: 'restored' },
      ),
    ).rejects.toMatchObject({ code: 'guard_failed' })
  })

  it('never writes the activity event when the fence fails', async () => {
    const sql = vi.fn()
    sql.mockResolvedValueOnce([WI_ROW]).mockResolvedValueOnce([])
    const query = vi.fn()
    ;(sql as unknown as { query: typeof query }).query = query

    await expect(
      updateWorkItem(
        sql as unknown as Sql,
        { tenantIds: ['t_1'], actor, expectedValues: { title: 'A' } },
        'wi_1',
        { title: 'restored' },
      ),
    ).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })

  it('leaves the UNFENCED zero-row classification untouched (still cycle / not_found)', async () => {
    const cycleSql = vi.fn()
    cycleSql
      .mockResolvedValueOnce([WI_ROW])
      .mockResolvedValueOnce([]) // no children
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: null }])
      .mockResolvedValueOnce([]) // UPDATE blocked by the cycle guard
    await expect(
      updateWorkItem(cycleSql as unknown as Sql, { tenantIds: ['t_1'], actor }, 'wi_1', {
        parent_id: 'wi_anc',
      }),
    ).rejects.toMatchObject({ code: 'cycle' })

    const goneSql = vi.fn()
    goneSql.mockResolvedValueOnce([WI_ROW]).mockResolvedValueOnce([])
    await expect(
      updateWorkItem(goneSql as unknown as Sql, { tenantIds: ['t_1'], actor }, 'wi_1', {
        phase: 'done',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
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

  it('an agent-applied update stamps the activity event with the REAL agent actor (run + on_behalf_of), never a spoofed human', async () => {
    const agentActor = {
      actorType: 'agent',
      actorId: 'run_1',
      onBehalfOf: 'u_approver',
      runId: 'run_1',
    } as const
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([WI_ROW]) // scoped select
      .mockResolvedValueOnce([{ ...WI_ROW, phase: 'done' }]) // guarded UPDATE returns the row
    const query = vi.fn().mockResolvedValueOnce([{}]) // activity_events insert (recordWrite → sql.query)
    ;(sql as unknown as { query: typeof query }).query = query

    await updateWorkItem(
      sql as unknown as Sql,
      { tenantIds: ['t_1'], actor: agentActor },
      'wi_1',
      { phase: 'done' },
    )

    // The activity_events insert must carry the agent's provenance, NOT actor_type
    // 'human' with the run id masquerading as a user (the H1 corruption).
    expect(query).toHaveBeenCalledTimes(1)
    const [text, params] = query.mock.calls[0] ?? []
    expect(text).toContain('activity_events')
    const p = params as unknown[]
    expect(p).toContain('agent') // actor_type
    expect(p).toContain('u_approver') // on_behalf_of = approver
    // run id is stamped as BOTH actor_id and run_id
    expect(p.filter((v) => v === 'run_1')).toHaveLength(2)
    // and it is NOT stamped as a human
    expect(p).not.toContain('human')
  })
})
