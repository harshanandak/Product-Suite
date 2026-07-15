import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const auth = { headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }

/**
 * Build a mock Sql: the tagged-template call resolves `callerTenantIds`; `sql.query`
 * dispatches the repository's parameterized reads/writes by matching the SQL text.
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

// A v1 delta: one user turn + the assistant reply.
const delta = (n: number) => ({
  version: 1,
  messages: [
    { id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `q${n}` }] },
    { id: `a${n}`, role: 'assistant', parts: [{ type: 'text', text: `a${n}` }] },
  ],
})

describe('agent threads routes (tenant-scoped)', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('GET /threads lists the org’s non-archived threads (single-org caller)', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: (text) =>
        /from "chat_threads"/i.test(text)
          ? [{ id: 'th_1', title: 'First', linked_object: null, updated_at: '2026-07-15' }]
          : [],
    })
    const res = await app.request('/api/agent/threads', { ...auth })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { id: 'th_1', title: 'First', linked_object: null, updated_at: '2026-07-15' },
    ])
  })

  it('GET /threads is 400 ambiguous for a multi-org caller without org_id (never fans across orgs)', async () => {
    mockSql({ tenants: [{ tenant_id: 't_1' }, { tenant_id: 't_2' }] })
    const res = await app.request('/api/agent/threads', { ...auth })
    expect(res.status).toBe(400)
  })

  it('GET /threads/:id/messages reconstructs the thread by concatenating v1 deltas in order (v0 skipped)', async () => {
    const { query } = mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: (text) => {
        if (/from "chat_threads"/i.test(text)) {
          return [{ id: 'th_1', tenant_id: 't_1', title: 'x', linked_object: null, archived: false }]
        }
        if (/from "agent_runs"/i.test(text)) {
          // Run 1 (v1), a legacy v0 row (skipped), Run 2 (v1) — in created_at order.
          return [
            { transcript: delta(1) },
            { transcript: { messages: [{ role: 'assistant', content: 'legacy' }] } }, // v0: no version
            { transcript: delta(2) },
          ]
        }
        return []
      },
    })
    const res = await app.request('/api/agent/threads/th_1/messages', { ...auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { messages: { id: string; role: string }[] }
    // Two 2-message deltas concatenate to 4 UIMessages, in order; the v0 row is gone.
    expect(body.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    // The runs are read scoped to the thread's own tenant.
    const runRead = query.mock.calls.find(([t]) => /from "agent_runs"/i.test(String(t)))
    expect(runRead?.[1]).toEqual(['th_1', 't_1'])
  })

  it('GET /threads/:id/messages is 404 for a thread the caller does not own (no leak)', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: () => [], // getThreadScoped finds nothing → foreign/unknown id
    })
    const res = await app.request('/api/agent/threads/foreign/messages', { ...auth })
    expect(res.status).toBe(404)
  })

  it('POST /threads/:id/archive soft-deletes an owned thread', async () => {
    const { query } = mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: (text) => (/update "chat_threads"/i.test(text) ? [{ id: 'th_1' }] : []),
    })
    const res = await app.request('/api/agent/threads/th_1/archive', { method: 'POST', ...auth })
    expect(res.status).toBe(200)
    const update = query.mock.calls.find(([t]) => /update "chat_threads"/i.test(String(t)))
    expect(String(update?.[0])).toMatch(/archived = true/i)
  })

  it('POST /threads/:id/archive is 404 for a foreign thread (tenant isolation)', async () => {
    mockSql({
      tenants: [{ tenant_id: 't_1' }],
      query: () => [], // update matched 0 rows → not the caller's
    })
    const res = await app.request('/api/agent/threads/foreign/archive', { method: 'POST', ...auth })
    expect(res.status).toBe(404)
  })

  it('every thread route 401s without a bearer token', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const list = await app.request('/api/agent/threads')
    const messages = await app.request('/api/agent/threads/th_1/messages')
    const archive = await app.request('/api/agent/threads/th_1/archive', { method: 'POST' })
    expect(list.status).toBe(401)
    expect(messages.status).toBe(401)
    expect(archive.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
