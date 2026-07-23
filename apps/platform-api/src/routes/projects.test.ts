import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const ROW = {
  id: 'proj_1',
  name: 'Platform',
  kind: 'general',
  status: 'backlog',
  lead_id: null,
  target_date: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

/** {@link ROW} plus the list query's `left join` rollup columns. */
const LIST_ROW = { ...ROW, total_count: 3, done_count: 1 }

const auth = {
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
}

describe('GET /api/projects', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('returns tenant-scoped projects mapped to the contracts shape, with rollup counts', async () => {
    const sql = vi.fn(async () => [LIST_ROW])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/projects', { headers: { Authorization: 'Bearer token' } })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>[]
    expect(body[0]).toMatchObject({
      id: 'proj_1',
      name: 'Platform',
      kind: 'general',
      status: 'backlog',
      lead_id: null,
      target_date: null,
      totalCount: 3,
      doneCount: 1,
    })
    const params = sql.mock.calls[0]?.slice(1) ?? []
    expect(params).toContain('user_clerk_1')
  })

  it('correlates the count to the project OWN tenant, so a count cannot span tenants', async () => {
    // `work_items.project_id` references projects(id) with no tenant equality
    // constraint, so a row in another tenant CAN point at this project. The
    // rollup must therefore be correlated on tenant, not just project_id —
    // otherwise a foreign row inflates this tenant's count.
    //
    // This tier mocks `sql`, so it asserts the QUERY SHAPE that makes the leak
    // structurally impossible; the executed-semantics guarantee belongs to the
    // real-database contract tier.
    const sql = vi.fn(async () => [LIST_ROW])
    createSql.mockReturnValue(sql)

    await app.request('/api/projects', { headers: { Authorization: 'Bearer token' } })

    const text = (sql.mock.calls[0]?.[0] as unknown as string[]).join(' ')
    const normalized = text.replace(/\s+/g, ' ')
    expect(normalized).toContain('w.tenant_id = p.tenant_id')
    expect(normalized).toContain('w.project_id = p.id')
    // A bare group-by-then-join would reintroduce the leak.
    expect(normalized).not.toMatch(/group by\s+project_id\s*\)/)
  })

  it('reports 0/0 for a project with no work items, rather than dropping it', async () => {
    const sql = vi.fn(async () => [{ ...ROW, total_count: 0, done_count: 0 }])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/projects', { headers: { Authorization: 'Bearer token' } })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>[]
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ id: 'proj_1', totalCount: 0, doneCount: 0 })
  })

  it('returns a structured 500 when the DB query fails', async () => {
    createSql.mockReturnValue(
      vi.fn(async () => {
        throw new Error('connection reset')
      }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/api/projects', { headers: { Authorization: 'Bearer token' } })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load projects' })
    errorSpy.mockRestore()
  })

  it('returns 401 without a bearer token (no DB access)', async () => {
    const sql = vi.fn(async () => [LIST_ROW])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/projects')
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})

describe('POST /api/projects', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('creates a project in the caller’s org with status defaulting to backlog', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    const sqlQuery = vi.fn().mockResolvedValueOnce([ROW]) // insert ... returning (recordWrite)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/projects', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Platform' }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string; status: string }
    expect(created.id).toBe('proj_1')
    expect(created.status).toBe('backlog')
    // The insert is anchored to the caller's resolved tenant, with the default status.
    const insertParams = sqlQuery.mock.calls[0]?.[1] ?? []
    expect(insertParams).toContain('t_1')
    expect(insertParams).toContain('backlog')
  })

  it('accepts an explicit status, lead_id and target_date', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }])
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    const sqlQuery = vi
      .fn()
      .mockResolvedValueOnce([
        { ...ROW, status: 'planned', lead_id: 'user_kenji', target_date: '2026-09-01T00:00:00.000Z' },
      ]) // insert ... returning (recordWrite)
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/projects', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        name: 'Platform',
        status: 'planned',
        lead_id: 'user_kenji',
        target_date: '2026-09-01T00:00:00.000Z',
      }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { status: string; lead_id: string; target_date: string }
    expect(created).toMatchObject({
      status: 'planned',
      lead_id: 'user_kenji',
      target_date: '2026-09-01T00:00:00.000Z',
    })
    const insertParams = sqlQuery.mock.calls[0]?.[1] ?? []
    expect(insertParams).toContain('planned')
    expect(insertParams).toContain('user_kenji')
  })

  it('rejects an unknown status with 400 (no insert)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/projects', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Platform', status: 'shipping' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown status' })
    // Only the tenant lookup ran; no insert was attempted.
    expect(sql).toHaveBeenCalledTimes(1)
  })

  it('returns 403 when the caller is in no org', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]) // callerTenantIds -> []
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/projects', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Platform' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when the caller is in multiple orgs (ambiguous target)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }, { tenant_id: 't_2' }])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/projects', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ name: 'Platform' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is missing (no insert)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/projects', { method: 'POST', ...auth, body: '{}' })
    expect(res.status).toBe(400)
    expect(sql).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /api/projects/:id', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('updates status, lead_id and target_date on the caller’s project', async () => {
    const updated = { ...ROW, status: 'in_progress', lead_id: 'user_kenji', target_date: '2026-10-01T00:00:00.000Z' }
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([ROW]) // select existing
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
      .mockResolvedValueOnce([updated]) // update returning
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/projects/proj_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({
        status: 'in_progress',
        lead_id: 'user_kenji',
        target_date: '2026-10-01T00:00:00.000Z',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; lead_id: string; target_date: string }
    expect(body).toMatchObject({
      status: 'in_progress',
      lead_id: 'user_kenji',
      target_date: '2026-10-01T00:00:00.000Z',
    })
    const updateParams = sql.mock.calls[3]?.slice(1) ?? []
    expect(updateParams).toContain('in_progress')
  })

  it('rejects an unknown status with 400 (no update)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([ROW]) // select existing
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/projects/proj_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ status: 'shipping' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown status' })
    // callerTenantIds + select ran; no update was attempted.
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('cannot touch another org’s project — 404 with no update', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // select existing scoped to caller → not theirs
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/projects/proj_other', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(res.status).toBe(404)
    // The scoped SELECT found nothing; no UPDATE followed.
    expect(sql).toHaveBeenCalledTimes(2)
  })

  it('returns 404 when the caller is in no org (no row access)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]) // callerTenantIds -> []
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/projects/proj_1', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(res.status).toBe(404)
    expect(sql).toHaveBeenCalledTimes(1)
  })
})
