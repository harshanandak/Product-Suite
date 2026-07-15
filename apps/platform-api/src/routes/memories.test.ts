import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const auth = { headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }

const MEMORY = {
  id: 'm_1',
  tenant_id: 't_1',
  kind: 'decision',
  title: 'Use Postgres',
  body: 'x',
  root_id: 'm_1',
  supersedes_id: null,
  superseded_by_id: null,
  change_reason: null,
  status: 'active',
  scope_type: 'org',
  scope_id: null,
  topics: ['db'],
  created_by: 'u_1',
  created_at: '2026-07-15',
  updated_at: '2026-07-15',
}

/**
 * A mock Sql: tagged-template calls resolve auth (callerTenantIds via
 * organization_memberships, callerUserId via user_auth_identities); `sql.query`
 * dispatches the domain's parameterized reads/writes by matching the SQL text;
 * `sql.transaction` returns the supersede batch result.
 */
function mockSql(opts: {
  tenants: { tenant_id: string }[]
  userId?: string
  query?: (text: string, params: unknown[]) => unknown[]
  tx?: unknown[][]
}) {
  const sql = vi.fn((strings: TemplateStringsArray | string) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings)
    if (/organization_memberships/i.test(text)) return Promise.resolve(opts.tenants)
    if (/user_auth_identities/i.test(text))
      return Promise.resolve(opts.userId ? [{ user_id: opts.userId }] : [])
    return Promise.resolve([])
  }) as unknown as {
    (...a: unknown[]): unknown
    query: ReturnType<typeof vi.fn>
    transaction: ReturnType<typeof vi.fn>
  }
  const query = vi.fn(async (text: string, params: unknown[]) =>
    opts.query ? opts.query(text, params) : [],
  )
  const transaction = vi.fn(async () => opts.tx ?? [])
  ;(sql as unknown as { query: typeof query }).query = query
  ;(sql as unknown as { transaction: typeof transaction }).transaction = transaction
  createSql.mockReturnValue(sql)
  return { sql, query, transaction }
}

describe('memories routes (tenant-scoped)', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('GET /memories lists the caller’s org memories', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: (text) => (/from "memories"/i.test(text) ? [MEMORY] : []),
    })
    const res = await app.request('/api/memories', { ...auth })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([MEMORY])
  })

  it('GET /memories applies FTS + kind filters (scoped by tenant)', async () => {
    const { query } = mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: (text) => (/from "memories"/i.test(text) ? [MEMORY] : []),
    })
    const res = await app.request('/api/memories?q=postgres&kind=decision', { ...auth })
    expect(res.status).toBe(200)
    const list = query.mock.calls.find(([t]) => /from "memories"/i.test(String(t)))!
    expect(String(list[0])).toMatch(/plainto_tsquery/i)
    expect(list[1]).toContain('decision')
    expect(list[1]).toContain('postgres')
  })

  it('GET /memories/:id returns the memory + its supersession chain', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: (text) => {
        if (/root_id = \$1/i.test(text)) return [MEMORY] // getMemoryChain
        if (/from "memories"/i.test(text)) return [MEMORY] // getMemoryScoped
        return []
      },
    })
    const res = await app.request('/api/memories/m_1', { ...auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { memory: unknown; chain: unknown[] }
    expect(body.memory).toEqual(MEMORY)
    expect(body.chain).toHaveLength(1)
  })

  it('GET /memories/:id is 404 for a memory the caller does not own (no leak)', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }], query: () => [] })
    const res = await app.request('/api/memories/foreign', { ...auth })
    expect(res.status).toBe(404)
  })

  it('POST /memories creates a memory active-immediately (201)', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      userId: 'u_1',
      query: (text) => (/insert into "memories"/i.test(text) ? [MEMORY] : []),
    })
    const res = await app.request('/api/memories', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ kind: 'decision', title: 'Use Postgres', topics: ['db'] }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(MEMORY)
  })

  it('POST /memories is 400 without a title', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }], userId: 'u_1' })
    const res = await app.request('/api/memories', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ kind: 'decision' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /memories is 400 (ambiguous) for a multi-org caller without org_id', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }, { tenant_id: 't_2' }], userId: 'u_1' })
    const res = await app.request('/api/memories', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ kind: 'decision', title: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /memories/:id/supersede inserts a new version + latches the old', async () => {
    const NEW = { ...MEMORY, id: 'm_2', supersedes_id: 'm_1', change_reason: 'switched' }
    const { transaction } = mockSql({
      tenants: [{ tenant_id: 't_1' }],
      userId: 'u_1',
      query: (text) => (/from "memories"/i.test(text) ? [MEMORY] : []),
      tx: [[NEW], [{ id: 'm_1' }]],
    })
    const res = await app.request('/api/memories/m_1/supersede', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'Use MongoDB', change_reason: 'switched' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { id: string }).id).toBe('m_2')
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('POST /memories/:id/supersede is 400 without a change_reason', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      userId: 'u_1',
      query: (text) => (/from "memories"/i.test(text) ? [MEMORY] : []),
    })
    const res = await app.request('/api/memories/m_1/supersede', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /memories/:id/supersede is 404 for a foreign memory (tenant isolation)', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }], userId: 'u_1', query: () => [] })
    const res = await app.request('/api/memories/foreign/supersede', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ change_reason: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /memories/:id/retract keeps history (status→retracted)', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      userId: 'u_1',
      query: (text) =>
        /update "memories"/i.test(text) ? [{ ...MEMORY, status: 'retracted' }] : [MEMORY],
    })
    const res = await app.request('/api/memories/m_1/retract', { method: 'POST', ...auth })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('retracted')
  })

  it('POST /memories/:id/defer parks the memory (404 for a foreign id)', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }], userId: 'u_1', query: () => [] })
    const res = await app.request('/api/memories/foreign/defer', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ waiting_on: 'legal' }),
    })
    expect(res.status).toBe(404)
  })

  it('every memories route 401s without a bearer token', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const list = await app.request('/api/memories')
    const get = await app.request('/api/memories/m_1')
    const create = await app.request('/api/memories', { method: 'POST' })
    const supersede = await app.request('/api/memories/m_1/supersede', { method: 'POST' })
    expect(list.status).toBe(401)
    expect(get.status).toBe(401)
    expect(create.status).toBe(401)
    expect(supersede.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
