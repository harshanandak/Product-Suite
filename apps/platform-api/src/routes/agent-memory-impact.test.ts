import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const auth = { headers: { Authorization: 'Bearer token' } }

/**
 * Build a mock Sql: the tagged-template call resolves `callerTenantIds`; `sql.query`
 * dispatches the parameterized aggregate read.
 */
function mockSql(opts: {
  tenants: { tenant_id: string }[]
  query?: (text: string, params: unknown[]) => unknown[]
}) {
  const sql = vi.fn().mockResolvedValueOnce(opts.tenants) as unknown as {
    (...a: unknown[]): unknown
    query: ReturnType<typeof vi.fn>
  }
  const query = vi.fn(async (text: string, params: unknown[]) =>
    opts.query ? opts.query(text, params) : [],
  )
  ;(sql as unknown as { query: typeof query }).query = query
  createSql.mockReturnValue(sql)
  return { sql, query }
}

describe('agent memory-impact route (tenant-scoped)', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('GET /memory-impact returns the metric shape for a valid single-org caller (no rows)', async () => {
    const { query } = mockSql({ tenants: [{ tenant_id: 't_1' }], query: () => [] })
    const res = await app.request('/api/agent/memory-impact', { method: 'GET', ...auth })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      window_days: 30,
      holdout: { applied: 0, edited: 0, editRate: 0, rejected: 0, rejectRate: 0, threads: 0 },
      treated: { applied: 0, edited: 0, editRate: 0, rejected: 0, rejectRate: 0, threads: 0 },
      delta: 0,
      savedEdits: 0,
      ciLow: -1,
      ciHigh: 1,
      verdict: 'insufficient',
    })
    // The aggregate was scoped to the caller's single org.
    const gather = query.mock.calls.find(([t]) => /from "proposals"/i.test(String(t)))
    expect(gather?.[1]?.[0]).toEqual(['t_1'])
  })

  it('GET /memory-impact honors a custom window and clamps out-of-range values', async () => {
    const { query } = mockSql({ tenants: [{ tenant_id: 't_1' }], query: () => [] })
    const res = await app.request('/api/agent/memory-impact?window=9000', { method: 'GET', ...auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { window_days: number }
    expect(body.window_days).toBe(365)
    const gather = query.mock.calls.find(([t]) => /from "proposals"/i.test(String(t)))
    expect(gather?.[1]?.[1]).toBe('365')
  })

  it('GET /memory-impact is 400 ambiguous for a multi-org caller without org_id', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }, { tenant_id: 't_2' }] })
    const res = await app.request('/api/agent/memory-impact', { method: 'GET', ...auth })
    expect(res.status).toBe(400)
  })

  it('GET /memory-impact is 403 when the caller belongs to no org', async () => {
    mockSql({ tenants: [] })
    const res = await app.request('/api/agent/memory-impact', { method: 'GET', ...auth })
    expect(res.status).toBe(403)
  })

  it('GET /memory-impact 401s without a bearer token (no DB touched)', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/memory-impact', { method: 'GET' })
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
