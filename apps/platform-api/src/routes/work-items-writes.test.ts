import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

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

const auth = {
  headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
}

describe('work-item writes', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('POST creates in the caller’s single org (with a tenant-owned team + team status) and returns 201', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([{ n: 1 }]) // status belongs-to-team check (owned)
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    // The item + its "created" event are written as ONE atomic batch via
    // sql.transaction (recordWriteTx); it returns the first row of each statement.
    // recordWriteTx builds each statement via sql.query, then batches via sql.transaction.
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockResolvedValue([[WI_ROW], [{}]])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        title: 'A',
        team_id: 'team_1',
        status_id: 'status_1',
        department: 'Eng',
      }),
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { id: string; status_id: string }).status_id).toBe('status_1')
    // The team was verified against the caller's resolved tenant, not trusted from the body.
    const teamCheckParams = sql.mock.calls[1]?.slice(1) ?? []
    expect(teamCheckParams).toContain('team_1')
    expect(teamCheckParams).toContain('t_1')
    // The status was verified to belong to the SAME team — never trusted from the body.
    const statusCheckParams = sql.mock.calls[2]?.slice(1) ?? []
    expect(statusCheckParams).toContain('status_1')
    expect(statusCheckParams).toContain('team_1')
  })

  it('POST resolves the team default status when status_id is omitted', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([{ id: 'status_default' }]) // team default status lookup
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockResolvedValue([[WI_ROW], [{}]])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_1' }),
    })
    expect(res.status).toBe(201)
    // The default was DERIVED from the item's own team, never trusted from the body,
    // and excludes the reserved `triage` inbox category.
    const defaultLookupParams = sql.mock.calls[2]?.slice(1) ?? []
    expect(defaultLookupParams).toContain('team_1')
  })

  it('POST returns a clear error when the team has no default status', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([]) // team default status lookup: team has no statuses
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_1' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'team has no default status; add a status to this team before creating items',
    })
  })

  it('POST returns 400 for a status that is not the team’s (no cross-team use)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([]) // status check: not this team's -> unknown
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_1', status_id: 'status_other' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown status' })
  })

  it('POST defaults to the caller’s sole team (and its default status) when team_id is omitted', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ id: 'team_solo' }]) // resolveDefaultTeamId: tenant has exactly one team
      .mockResolvedValueOnce([{ id: 'status_default' }]) // that team's default status
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId (lazy actor)
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockResolvedValue([[{ ...WI_ROW, team_id: 'team_solo', status_id: 'status_default' }], [{}]])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A' }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { team_id: string; status_id: string }
    expect(created.team_id).toBe('team_solo')
    expect(created.status_id).toBe('status_default')
    // The default team was DERIVED from the caller's resolved tenant, never trusted from the body.
    const teamLookupParams = sql.mock.calls[1]?.slice(1) ?? []
    expect(teamLookupParams).toContain('t_1')
  })

  it('POST returns 400 for a team belonging to another tenant (no cross-tenant use)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // team check: not in caller's tenant -> unknown
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_other' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown team' })
  })

  it('POST returns 403 when the caller is in no org', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]) // callerTenantIds -> []
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ team_id: 'team_1' }),
    })
    expect(res.status).toBe(403)
  })

  it('POST returns 400 when the caller is in multiple orgs (ambiguous target)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }, { tenant_id: 't_2' }])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ team_id: 'team_1' }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH returns 404 for an item outside the caller’s org (no leak)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // scoped select -> not theirs
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items/wi_x', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ phase: 'done' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH updates an owned item and returns it (200)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned)
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
      .mockResolvedValueOnce([{ ...WI_ROW, phase: 'done' }]) // update returning
    const sqlQuery = vi.fn().mockResolvedValueOnce([{}]) // activity insert (recordWrite via sql.query)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ phase: 'done' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { phase: string }).phase).toBe('done')
  })

  it('PATCH returns 400 when reassigning to a team outside the caller’s org', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned)
      .mockResolvedValueOnce([]) // team check: not in caller's tenant -> unknown
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ team_id: 'team_other' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown team' })
  })

  it('PATCH returns 400 when moving to a status outside the item’s team', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned)
      .mockResolvedValueOnce([]) // status check: not the item's team's -> unknown
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ status_id: 'status_other' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown status' })
    // The status was checked against the item's own team_id (from the fetched row).
    const statusCheckParams = sql.mock.calls[2]?.slice(1) ?? []
    expect(statusCheckParams).toContain('status_other')
    expect(statusCheckParams).toContain('team_1')
  })

  it('PATCH accepts a status that belongs to the item’s team (200)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned)
      .mockResolvedValueOnce([{ n: 1 }]) // status check (belongs to team)
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
      .mockResolvedValueOnce([{ ...WI_ROW, status_id: 'status_2' }]) // update returning
    const sqlQuery = vi.fn().mockResolvedValueOnce([{}]) // activity insert (recordWrite via sql.query)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ status_id: 'status_2' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status_id: string }).status_id).toBe('status_2')
  })

  it('POST creates a Task under a top-level parent (depth=1, parent verified in-tenant + same team)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([{ n: 1 }]) // status belongs-to-team check (owned)
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: null }]) // parent: top-level, same team
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    // recordWriteTx builds each statement via sql.query, then batches via sql.transaction.
    ;(sql as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn()
    ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
      .fn()
      .mockResolvedValue([[{ ...WI_ROW, parent_id: 'wi_parent', depth: 1 }], [{}]])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        title: 'A',
        team_id: 'team_1',
        status_id: 'status_1',
        parent_id: 'wi_parent',
      }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { parent_id: string; depth: number }
    expect(created.parent_id).toBe('wi_parent')
    expect(created.depth).toBe(1)
    // The parent was looked up scoped to the caller's resolved tenant, not trusted.
    const parentCheckParams = sql.mock.calls[3]?.slice(1) ?? []
    expect(parentCheckParams).toContain('wi_parent')
    expect(parentCheckParams).toContain('t_1')
  })

  it('POST rejects a parent on a different team (a Task inherits its parent’s team)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([{ n: 1 }]) // status belongs-to-team check (owned)
      .mockResolvedValueOnce([{ team_id: 'team_other', parent_id: null }]) // parent: different team
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_1', status_id: 'status_1', parent_id: 'wi_parent' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'parent belongs to a different team' })
  })

  it('POST rejects nesting past depth 1 (the parent already has a parent)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([{ n: 1 }]) // status belongs-to-team check (owned)
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: 'wi_grandparent' }]) // parent is itself a child
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_1', status_id: 'status_1', parent_id: 'wi_parent' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'max nesting depth is 1' })
  })

  it('POST rejects an unknown/out-of-tenant parent', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([{ n: 1 }]) // status belongs-to-team check (owned)
      .mockResolvedValueOnce([]) // parent lookup: not in tenant -> unknown
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_1', status_id: 'status_1', parent_id: 'wi_ghost' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown parent' })
  })

  it('PATCH sets a parent on an owned item (depth=1) and returns it', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned, top-level)
      .mockResolvedValueOnce([]) // child-existence check: item has no sub-items
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: null }]) // parent: top-level, same team
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
      .mockResolvedValueOnce([{ ...WI_ROW, parent_id: 'wi_parent', depth: 1 }]) // update returning
    const sqlQuery = vi.fn().mockResolvedValueOnce([{}]) // activity insert (recordWrite via sql.query)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ parent_id: 'wi_parent' }),
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as { parent_id: string; depth: number }
    expect(updated.parent_id).toBe('wi_parent')
    expect(updated.depth).toBe(1)
  })

  it('PATCH rejects making an item its own parent (self-cycle, no lookup)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned)
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ parent_id: 'wi_1' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A work item cannot be its own parent' })
    // Rejected before any parent lookup — only tenant + scoped-select ran.
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('PATCH rejects a descendant as parent (proposed parent already has a parent → depth cap)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned)
      .mockResolvedValueOnce([]) // child-existence check: no sub-items
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: 'wi_1' }]) // proposed parent is a child of wi_1
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ parent_id: 'wi_child' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'max nesting depth is 1' })
  })

  it('PATCH returns 400 (cycle) when the atomic guard blocks a parent-set', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned)
      .mockResolvedValueOnce([]) // child-existence check: no sub-items
      .mockResolvedValueOnce([{ team_id: 'team_1', parent_id: null }]) // parent passes pre-checks
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
      .mockResolvedValueOnce([]) // update matched no row -> reachability guard blocked it
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ parent_id: 'wi_parent' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'parent_id would create a cycle' })
  })

  it('PATCH rejects nesting an item that already has sub-items (child-side depth cap)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned, top-level)
      .mockResolvedValueOnce([{ one: 1 }]) // child-existence check: item HAS sub-items
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ parent_id: 'wi_parent' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot nest an item that has its own sub-items' })
  })

  it('PATCH rejects changing a sub-item’s team while it stays parented', async () => {
    const CHILD = { ...WI_ROW, parent_id: 'wi_parent', depth: 1 }
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([CHILD]) // scoped select (owned, already parented)
      .mockResolvedValueOnce([{ one: 1 }]) // team reassign: team_2 is in the caller's tenant
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ team_id: 'team_2' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'cannot change a sub-item’s team; re-parent or unparent it first',
    })
  })

  it('PATCH rejects changing the team of a top-level item that HAS sub-items', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([WI_ROW]) // scoped select (owned, top-level, no parent)
      .mockResolvedValueOnce([{ one: 1 }]) // team reassign: team_2 in tenant
      .mockResolvedValueOnce([{ one: 1 }]) // has-children check: item HAS sub-items
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ team_id: 'team_2' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'cannot change the team of an item with sub-items; move or detach them first',
    })
  })

  it('PATCH clearing parent_id resets depth to 0 (no parent lookup)', async () => {
    const CHILD_ROW = { ...WI_ROW, parent_id: 'wi_parent', depth: 1 }
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([CHILD_ROW]) // scoped select (owned, a Task)
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
      .mockResolvedValueOnce([{ ...CHILD_ROW, parent_id: null, depth: 0 }]) // update returning
    const sqlQuery = vi.fn().mockResolvedValueOnce([{}]) // activity insert (recordWrite via sql.query)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ parent_id: null }),
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as { parent_id: string | null; depth: number }
    expect(updated.parent_id).toBeNull()
    expect(updated.depth).toBe(0)
    // No parent lookup ran for a clear — tenant, select, callerUserId, update
    // (the activity insert is a separate sql.query call, not counted here).
    expect(sql).toHaveBeenCalledTimes(4)
  })

  it('GET /:id/activity returns the feed for an owned item', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // ownership check
      .mockResolvedValueOnce([
        {
          id: 'a1',
          work_item_id: 'wi_1',
          kind: 'created',
          summary: 'Created',
          created_at: '2026-07-01T00:00:00.000Z',
        },
      ])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items/wi_1/activity', { headers: auth.headers })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { kind: string }[])[0]?.kind).toBe('created')
  })
})
