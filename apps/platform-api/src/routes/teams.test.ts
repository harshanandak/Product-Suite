import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const ROW = {
  id: 'team_1',
  tenant_id: 't_1',
  name: 'Engineering',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

const auth = {
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
}

describe('GET /api/teams', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('returns tenant-scoped teams mapped to the contracts shape', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/teams', { headers: auth.headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>[]
    expect(body[0]).toMatchObject({ id: 'team_1', tenant_id: 't_1', name: 'Engineering' })
    // The list is scoped by the caller's Clerk subject — proves no cross-tenant leak.
    const params = sql.mock.calls[0]?.slice(1) ?? []
    expect(params).toContain('user_clerk_1')
  })

  it('returns a structured 500 when the DB query fails', async () => {
    createSql.mockReturnValue(
      vi.fn(async () => {
        throw new Error('connection reset')
      }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/api/teams', { headers: auth.headers })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load teams' })
    errorSpy.mockRestore()
  })

  it('returns 401 without a bearer token (no DB access)', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/teams')
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})

describe('POST /api/teams', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('creates a team in the caller’s single org and returns 201, stamping human provenance', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds (tagged)
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId (tagged)
    // recordWrite writes through sql.query(text, params) (neon v1.x).
    const sqlQuery = vi.fn().mockResolvedValueOnce([ROW])
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/teams', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Engineering' }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string; tenant_id: string }
    expect(created.id).toBe('team_1')

    // The insert is anchored to the caller's resolved tenant — never a client org —
    // and stamps the human actor (actor_type='human', actor_id=the caller's user id).
    const [insertText, insertParams] = sqlQuery.mock.calls[0] ?? []
    expect(insertText).toContain('insert into "teams"')
    expect(insertText).toContain('returning *')
    expect(insertParams).toContain('t_1')
    expect(insertParams).toContain('human')
    expect(insertParams).toContain('u_1')
  })

  it('ignores any actor_* smuggled in the request body (provenance is server-derived)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    const sqlQuery = vi.fn().mockResolvedValueOnce([ROW]) // recordWrite insert (sql.query)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/teams', {
      method: 'POST',
      ...auth,
      // Attacker tries to attribute the write to someone else / a fake actor.
      body: JSON.stringify({ name: 'Engineering', actor_type: 'system', actor_id: 'u_evil' }),
    })
    expect(res.status).toBe(201)
    // The forged values never reach the insert — only the server-derived human actor
    // does (the route reads the body field-by-field, never spreading it).
    const insertParams = (sqlQuery.mock.calls[0]?.[1] ?? []) as unknown[]
    expect(insertParams).not.toContain('u_evil')
    expect(insertParams).not.toContain('system')
    expect(insertParams).toContain('human')
  })

  it('returns 500 when the tenant resolves but the user identity does not', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // callerUserId -> no row
    createSql.mockReturnValue(sql)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.request('/api/teams', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Engineering' }),
    })
    expect(res.status).toBe(500)
    // No write is attempted without an attributable actor: only the two lookups ran.
    expect(sql).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })

  it('returns 403 when the caller is in no org', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]) // callerTenantIds -> []
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/teams', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Engineering' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when the caller is in multiple orgs (ambiguous target)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }, { tenant_id: 't_2' }])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/teams', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Engineering' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is missing (no insert)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/teams', { method: 'POST', ...auth, body: '{}' })
    expect(res.status).toBe(400)
    // Only the tenant lookup ran; no insert was attempted.
    expect(sql).toHaveBeenCalledTimes(1)
  })
})
