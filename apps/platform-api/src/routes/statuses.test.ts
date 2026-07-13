import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const ROW = {
  id: 'status_1',
  team_id: 'team_1',
  name: 'In Progress',
  category: 'started',
  position: 3,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

const auth = {
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
}

describe('GET /api/statuses', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('returns a team’s statuses mapped to the contracts shape, scoped to the caller', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/statuses?team_id=team_1', { headers: auth.headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>[]
    expect(body[0]).toMatchObject({
      id: 'status_1',
      team_id: 'team_1',
      name: 'In Progress',
      category: 'started',
      position: 3,
    })
    // The list is scoped by both the requested team AND the caller's Clerk subject
    // (the team's tenant must be one the caller belongs to) — proves no leak.
    const params = sql.mock.calls[0]?.slice(1) ?? []
    expect(params).toContain('team_1')
    expect(params).toContain('user_clerk_1')
  })

  it('returns 400 when team_id is missing (no DB access)', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/statuses', { headers: auth.headers })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'team_id is required' })
    expect(sql).not.toHaveBeenCalled()
  })

  it('returns a structured 500 when the DB query fails', async () => {
    createSql.mockReturnValue(
      vi.fn(async () => {
        throw new Error('connection reset')
      }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/api/statuses?team_id=team_1', { headers: auth.headers })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load statuses' })
    errorSpy.mockRestore()
  })

  it('returns 401 without a bearer token (no DB access)', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/statuses?team_id=team_1')
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})

describe('POST /api/statuses', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('creates a status on a caller-owned team and returns 201', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // team ownership check (owned)
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    const sqlQuery = vi.fn().mockResolvedValueOnce([ROW]) // insert ... returning (recordWrite)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/statuses', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ team_id: 'team_1', name: 'In Progress', category: 'started' }),
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { id: string }).id).toBe('status_1')
    // The team was verified against the caller's resolved tenants, not trusted from the body.
    const teamCheckParams = sql.mock.calls[1]?.slice(1) ?? []
    expect(teamCheckParams).toContain('team_1')
  })

  it('returns 400 for an invalid category (not in the enum, no insert)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/statuses', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ team_id: 'team_1', name: 'Bogus', category: 'nonsense' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid category' })
    // Rejected before any team lookup — only the tenant lookup ran.
    expect(sql).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for a team outside the caller’s orgs (unknown team)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // team check: not the caller's -> unknown
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/statuses', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ team_id: 'team_other', name: 'In Progress', category: 'started' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown team' })
  })

  it('returns 400 when name is missing (no insert)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/statuses', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ team_id: 'team_1', category: 'started' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'name is required' })
    expect(sql).toHaveBeenCalledTimes(1)
  })

  it('returns 403 when the caller is in no org', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]) // callerTenantIds -> []
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/statuses', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ team_id: 'team_1', name: 'In Progress', category: 'started' }),
    })
    expect(res.status).toBe(403)
  })
})
