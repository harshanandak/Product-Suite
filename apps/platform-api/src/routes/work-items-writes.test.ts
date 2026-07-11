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

  it('POST creates in the caller’s single org (with a tenant-owned team) and returns 201', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([WI_ROW]) // insert ... returning *
      .mockResolvedValueOnce([]) // activity insert
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A', team_id: 'team_1', department: 'Eng' }),
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { id: string }).id).toBe('wi_1')
    // The team was verified against the caller's resolved tenant, not trusted from the body.
    const teamCheckParams = sql.mock.calls[1]?.slice(1) ?? []
    expect(teamCheckParams).toContain('team_1')
    expect(teamCheckParams).toContain('t_1')
  })

  it('POST returns 400 when team_id is missing (team is mandatory)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/work-items', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'A' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'team_id is required' })
    // Rejected before any insert — only the tenant lookup ran.
    expect(sql).toHaveBeenCalledTimes(1)
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
      .mockResolvedValueOnce([{ ...WI_ROW, phase: 'done' }]) // update returning
      .mockResolvedValueOnce([]) // activity insert
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
