import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const auth = { headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }

/**
 * Build a mock Sql: the tagged-template call resolves `callerTenantIds`; `sql.query`
 * dispatches parameterized reads/writes by matching the SQL text.
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

describe('agent reflection route (tenant-scoped)', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('POST /reflection/run returns the reflection result for a single-org caller (no corrections)', async () => {
    // No corrections to mine → runReflection short-circuits before any LLM call.
    const { query } = mockSql({ tenants: [{ tenant_id: 't_1' }], query: () => [] })
    const res = await app.request('/api/agent/reflection/run', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ proposalsCreated: 0, ruleProposalIds: [], consumedProposalIds: [] })
    // The corrections gather was scoped to the caller's single org.
    const gather = query.mock.calls.find(([t]) => /from "proposals"/i.test(String(t)))
    expect(gather?.[1]?.[0]).toBe('t_1')
  })

  it('POST /reflection/run is 400 ambiguous for a multi-org caller without org_id', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }, { tenant_id: 't_2' }] })
    const res = await app.request('/api/agent/reflection/run', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /reflection/run is 403 when the caller belongs to no org', async () => {
    mockSql({ tenants: [] })
    const res = await app.request('/api/agent/reflection/run', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('POST /reflection/run 401s without a bearer token (no DB touched)', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/reflection/run', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
