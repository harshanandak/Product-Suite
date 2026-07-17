import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const auth = { headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }

/** Mock Sql: the tagged call resolves `callerTenantIds`; `sql.query` returns [] for all reads/writes. */
function mockSql(opts: { tenants: { tenant_id: string }[] }) {
  const sql = vi.fn().mockResolvedValueOnce(opts.tenants) as unknown as {
    (...a: unknown[]): unknown
    query: ReturnType<typeof vi.fn>
  }
  const query = vi.fn(async () => [])
  ;(sql as unknown as { query: typeof query }).query = query
  createSql.mockReturnValue(sql)
  return { sql, query }
}

describe('agent KB ingest route (tenant-scoped)', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('POST /kb/ingest returns the ingest counts for a single-org caller (nothing to ingest)', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }] })
    const res = await app.request('/api/agent/kb/ingest', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ memoriesEmbedded: 0, chunksIngested: 0 })
  })

  it('POST /kb/ingest is 400 ambiguous for a multi-org caller without org_id', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }, { tenant_id: 't_2' }] })
    const res = await app.request('/api/agent/kb/ingest', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /kb/ingest is 403 when the caller belongs to no org', async () => {
    mockSql({ tenants: [] })
    const res = await app.request('/api/agent/kb/ingest', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('POST /kb/ingest 401s without a bearer token (no DB touched)', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/kb/ingest', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
