import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const WI_ROW = {
  id: 'wi_new',
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

const PROPOSAL = {
  id: 'p1',
  tenant_id: 't_1',
  run_id: 'run_1',
  target_type: 'work_item',
  target_id: null,
  operation: 'create',
  payload: { title: 'A', team_id: 'team_1', status_id: 'status_1', department: 'Eng' },
  edited_payload: null,
  target_version: null,
  status: 'pending',
}

const auth = {
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
}

/**
 * Text-routing `sql` mock covering the whole accept path end-to-end: the auth
 * lookups (memberships → user), the proposal load, the exactly-once CLAIM (flips
 * closure-held status), the domain command's ownership reads + write batch, and the
 * decision mutations. `getStatus()` exposes the proposal's final lifecycle state.
 */
function makeSql(opts: { proposal?: Record<string, unknown> } = {}) {
  const proposal = { ...PROPOSAL, ...(opts.proposal ?? {}) }
  let status = proposal.status as string

  const query = vi.fn(async (text: string, _params: unknown[]) => {
    if (text.includes("set status = 'applied'")) {
      if (status === 'pending') {
        status = 'applied'
        return [{ ...proposal, status: 'applied' }]
      }
      return []
    }
    if (text.includes('set applied_write')) return []
    if (text.includes('insert into')) return [WI_ROW] // recordWriteTx build (ignored; transaction returns rows)
    return []
  })

  const sql = vi.fn(async (strings: TemplateStringsArray, ..._params: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings)
    if (text.includes('organization_memberships')) return [{ tenant_id: 't_1' }]
    if (text.includes('user_auth_identities')) return [{ user_id: 'u_approver' }]
    if (text.includes('from teams')) return [{ n: 1 }]
    if (text.includes('from statuses')) return [{ n: 1 }]
    if (text.includes("set status = 'rejected'")) {
      status = 'rejected'
      return [{ ...proposal, status: 'rejected' }]
    }
    if (text.includes('from proposals')) return [{ ...proposal, status }]
    return []
  }) as unknown as ReturnType<typeof vi.fn>
  ;(sql as unknown as { query: typeof query }).query = query
  ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
    .fn()
    .mockResolvedValue([[WI_ROW], [{}]])

  return { sql, getStatus: () => status }
}

describe('/api/agent/proposals', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('GET returns the caller’s pending proposals, tenant-scoped', async () => {
    const { sql } = makeSql({})
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals', { headers: auth.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>[]
    expect(body[0]).toMatchObject({ id: 'p1', status: 'pending' })
    // Scoped by the caller's Clerk subject — proves no cross-tenant leak.
    const membershipCall = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
      (call) => Array.isArray(call[0]) && (call[0] as string[]).join('?').includes('organization_memberships'),
    )
    expect(membershipCall?.slice(1)).toContain('user_clerk_1')
  })

  it('GET returns 401 without a bearer token (no DB access)', async () => {
    const { sql } = makeSql({})
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/proposals')
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })

  it('POST /:id/accept applies a pending proposal and returns 200', async () => {
    const { sql, getStatus } = makeSql({})
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/accept', { method: 'POST', ...auth })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe('wi_new')
    expect(getStatus()).toBe('applied')
  })

  it('POST /:id/accept forwards edited_payload to the claim (persists the human gold-label edit)', async () => {
    const { sql } = makeSql({})
    createSql.mockReturnValue(sql)

    const editedPayload = { title: 'A', team_id: 'team_1', status_id: 'status_1', department: 'Ops' }
    const res = await app.request('/api/agent/proposals/p1/accept', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ edited_payload: editedPayload }),
    })
    expect(res.status).toBe(200)
    // The edit is bound as $3 on the atomic claim UPDATE (not dropped by the route).
    const claim = (
      (sql as unknown as { query: { mock: { calls: [string, unknown[]][] } } }).query.mock.calls
    ).find(([t]) => t.includes("set status = 'applied'"))
    expect(claim?.[0]).toContain('edited_payload = coalesce($3::jsonb, edited_payload)')
    expect(claim?.[1]?.[2]).toBe(JSON.stringify(editedPayload))
  })

  it('POST /:id/accept with NO body still applies and returns 200 (backward compatible)', async () => {
    const { sql, getStatus } = makeSql({})
    createSql.mockReturnValue(sql)

    // No Content-Type / no body — the route must not choke on an empty JSON parse.
    const res = await app.request('/api/agent/proposals/p1/accept', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    })
    expect(res.status).toBe(200)
    expect(getStatus()).toBe('applied')
    const claim = (
      (sql as unknown as { query: { mock: { calls: [string, unknown[]][] } } }).query.mock.calls
    ).find(([t]) => t.includes("set status = 'applied'"))
    expect(claim?.[1]?.[2]).toBeNull()
  })

  it('POST /:id/accept a second time returns 409 (no longer pending)', async () => {
    const { sql } = makeSql({})
    createSql.mockReturnValue(sql)

    const first = await app.request('/api/agent/proposals/p1/accept', { method: 'POST', ...auth })
    expect(first.status).toBe(200)
    const second = await app.request('/api/agent/proposals/p1/accept', { method: 'POST', ...auth })
    expect(second.status).toBe(409)
  })

  it('POST /:id/reject marks a pending proposal rejected and returns 200', async () => {
    const { sql, getStatus } = makeSql({})
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/reject', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ reason: 'not aligned' }),
    })
    expect(res.status).toBe(200)
    expect(getStatus()).toBe('rejected')
  })
})
