import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

// Accept-time validation rejects any id that is not a well-formed UUID (a slug would
// `22P02` against a uuid column), so fixtures use canonical ids that reach the domain.
const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const STATUS_ID = '22222222-2222-4222-8222-222222222222'

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
  team_id: TEAM_ID,
  status_id: STATUS_ID,
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
  payload: { title: 'A', team_id: TEAM_ID, status_id: STATUS_ID, department: 'Eng' },
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
function makeSql(
  opts: {
    proposal?: Record<string, unknown>
    /** Rows the run_memory_attributions→memories join returns (active rules). */
    rules?: { id: string; title: string }[]
    /** When true, the proposal load returns no row (not in the caller's tenants). */
    proposalMissing?: boolean
  } = {},
) {
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
    if (text.includes('run_memory_attributions')) return opts.rules ?? []
    if (text.includes("set status = 'rejected'")) {
      status = 'rejected'
      return [{ ...proposal, status: 'rejected' }]
    }
    if (text.includes('from proposals')) return opts.proposalMissing ? [] : [{ ...proposal, status }]
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
    // The accept endpoint returns the stable AcceptResult envelope in the body.
    const body = (await res.json()) as { status: string; proposal_id: string; item_id: string }
    expect(body).toEqual({ status: 'applied', proposal_id: 'p1', item_id: 'wi_new' })
    expect(getStatus()).toBe('applied')
  })

  it('POST /:id/accept forwards edited_payload to the claim (persists the human gold-label edit)', async () => {
    const { sql } = makeSql({})
    createSql.mockReturnValue(sql)

    const editedPayload = { title: 'A', team_id: TEAM_ID, status_id: STATUS_ID, department: 'Ops' }
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

  it('GET /:id/active-rules returns the non-suppressed rule titles for the proposal’s run', async () => {
    const { sql } = makeSql({
      rules: [
        { id: 'm_1', title: 'Prefer concise titles' },
        { id: 'm_2', title: 'Tag pricing work' },
      ],
    })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/active-rules', { headers: auth.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rules: { id: string; title: string }[] }
    expect(body.rules).toEqual([
      { id: 'm_1', title: 'Prefer concise titles' },
      { id: 'm_2', title: 'Tag pricing work' },
    ])
    // The join is keyed on the proposal's run_id (proves the scope).
    const joinCall = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
      (call) => Array.isArray(call[0]) && (call[0] as string[]).join('?').includes('run_memory_attributions'),
    )
    expect(joinCall?.slice(1)).toContain('run_1')
  })

  it('GET /:id/active-rules returns an empty array when the run has none (e.g. a holdout run)', async () => {
    // A holdout run logged its attributions suppressed=true, so the suppressed=false
    // join returns nothing — the proposal correctly shows NO active rules.
    const { sql } = makeSql({ rules: [] })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/active-rules', { headers: auth.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rules: unknown[] }
    expect(body.rules).toEqual([])
  })

  it('GET /:id/active-rules returns an empty array when the proposal has no run_id (never 404)', async () => {
    const { sql } = makeSql({ proposal: { run_id: null } })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/active-rules', { headers: auth.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rules: unknown[] }
    expect(body.rules).toEqual([])
    // Short-circuits before the join — no attribution query is issued.
    const joinCall = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
      (call) => Array.isArray(call[0]) && (call[0] as string[]).join('?').includes('run_memory_attributions'),
    )
    expect(joinCall).toBeUndefined()
  })

  it('GET /:id/active-rules query keeps the moat-integrity filter (suppressed=false AND kind=rule)', async () => {
    // The mock echoes rows regardless of the WHERE, so the holdout→empty test can't
    // catch a silently-dropped predicate. Assert the query TEXT instead: the
    // suppressed-attribution and rule-kind filters must survive any refactor.
    const { sql } = makeSql({ rules: [{ id: 'm_1', title: 'Prefer concise titles' }] })
    createSql.mockReturnValue(sql)

    await app.request('/api/agent/proposals/p1/active-rules', { headers: auth.headers })

    const joinCall = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
      (call) => Array.isArray(call[0]) && (call[0] as string[]).join('?').includes('run_memory_attributions'),
    )
    const text = (joinCall?.[0] as string[]).join('?')
    expect(text).toContain('a.suppressed = false')
    expect(text).toContain("m.kind = 'rule'")
  })

  it('GET /:id/active-rules returns 404 when the proposal is not the caller’s', async () => {
    const { sql } = makeSql({ proposalMissing: true })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/active-rules', { headers: auth.headers })
    expect(res.status).toBe(404)
  })
})
