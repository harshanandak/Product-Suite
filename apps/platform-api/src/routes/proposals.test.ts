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
    /** Rows the curator's `searchMemories` probes return (FTS over `memories`). */
    memories?: Record<string, unknown>[]
    /** When true, no user identity maps to the subject (the fail-closed asker case). */
    noUserIdentity?: boolean
    /** The target work item's CURRENT row (the undo path's conflict check reads it). */
    current?: Record<string, unknown> | null
  } = {},
) {
  const proposal = { ...PROPOSAL, ...(opts.proposal ?? {}) }
  let status = proposal.status as string
  // The undo record lives INSIDE applied_write (no new column). `undone` mirrors the
  // guarded mark so a second undo in the same test finds it already stamped.
  let appliedWrite = (proposal as Record<string, unknown>).applied_write ?? null
  let undone = Boolean(
    (appliedWrite as Record<string, Record<string, unknown>> | null)?.__undo?.undone_at,
  )

  const query = vi.fn(async (text: string, params: unknown[]) => {
    if (text.includes("status = case when") && text.includes("status = 'pending'")) {
      if (status !== 'pending') return []
      status = params[3] === null ? 'accepted' : 'accepted_with_edits'
      return [{ ...proposal, status, decided_by: params[2], edited_payload: params[3] }]
    }
    if (text.includes("set status = 'applied'")) {
      if (status === 'pending') {
        status = 'applied'
        return [{ ...proposal, status: 'applied' }]
      }
      return []
    }
    if (text.includes('set applied_write')) {
      // The undo mark: guarded on still-applied AND not-yet-undone (see undo.ts).
      if (undone) return []
      undone = true
      appliedWrite = JSON.parse(params[0] as string)
      return [{ id: 'p1' }]
    }
    if (text.includes('insert into')) return [WI_ROW] // recordWriteTx build (ignored; transaction returns rows)
    // The curator's FTS probes. Routed on the table + the tsquery so a lane the curator
    // should NOT have issued still lands here and stays visible to assertions.
    if (text.includes('from "memories"') && text.includes('plainto_tsquery')) {
      return opts.memories ?? []
    }
    return []
  })

  const sql = vi.fn(async (strings: TemplateStringsArray, ..._params: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings)
    if (text.includes('organization_memberships')) return [{ tenant_id: 't_1', user_id: 'u_approver', role: 'member', status: 'active' }]
    if (text.includes('user_auth_identities')) return opts.noUserIdentity ? [] : [{ user_id: 'u_approver' }]
    if (text.includes('from teams')) return [{ n: 1 }]
    if (text.includes('from statuses')) return [{ n: 1 }]
    if (text.includes('run_memory_attributions')) return opts.rules ?? []
    if (text.includes("set status = 'rejected'")) {
      status = 'rejected'
      return [{ ...proposal, status: 'rejected' }]
    }
    // Only the undo tests opt into a target row (`current`); every other test keeps
    // the original no-rows behaviour so the accept path's guards are unchanged.
    // `row_json` mirrors Postgres's `to_jsonb(work_items)` — what the undo's
    // compare-and-set fence is built from.
    const readsWholeRow =
      text.includes('select * from work_items') ||
      text.includes('to_jsonb(work_items) as row_json')
    if (opts.current !== undefined && readsWholeRow) {
      if (opts.current === null) return []
      const row = { ...WI_ROW, ...opts.current }
      return [{ ...row, row_json: row }]
    }
    if (opts.current != null && text.includes('update work_items')) {
      return [{ ...WI_ROW, ...opts.current }]
    }
    if (text.includes('from proposals')) {
      return opts.proposalMissing ? [] : [{ ...proposal, status, applied_write: appliedWrite }]
    }
    return []
  }) as unknown as ReturnType<typeof vi.fn>
  ;(sql as unknown as { query: typeof query }).query = query
  ;(sql as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction = vi
    .fn()
    .mockResolvedValue([[WI_ROW], [{}]])

  return { sql, query, getStatus: () => status, getAppliedWrite: () => appliedWrite }
}

/** A memory proposal the curator will curate, and a row for its probes to return. */
const MEMORY_PROPOSAL = {
  target_type: 'memory',
  target_id: null,
  operation: 'create',
  payload: {
    kind: 'fact',
    title: 'Pricing pages ship through the growth review',
    body: 'The growth lead signs off before a pricing page goes live.',
  },
}

const MEMORY_HIT = {
  id: 'm_existing',
  kind: 'fact',
  title: 'Pricing pages ship through the growth review',
  body: 'The growth lead signs off before any pricing page goes live.',
  status: 'active',
  topics: [],
  root_id: 'm_existing',
  scope_type: 'org',
  scope_id: null,
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

  // The inbox list returns ONLY pending proposals, so a `?proposal=<id>` deep-link
  // whose target was already disposed of is indistinguishable from a bogus id without
  // this lookup — and the inbox must never answer a dead link by putting a DIFFERENT
  // pending proposal under the reviewer's Accept button.
  describe('GET /:id (deep-link resolution)', () => {
    const PROPOSAL_UUID = '33333333-3333-4333-8333-333333333333'

    it('returns a DISPOSED proposal (not just pending ones), tenant-scoped', async () => {
      const { sql } = makeSql({ proposal: { id: PROPOSAL_UUID, status: 'applied' } })
      createSql.mockReturnValue(sql)

      const res = await app.request(`/api/agent/proposals/${PROPOSAL_UUID}`, {
        headers: auth.headers,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id: PROPOSAL_UUID, status: 'applied' })
    })

    it('404s a proposal that is not the caller’s', async () => {
      const { sql } = makeSql({ proposalMissing: true })
      createSql.mockReturnValue(sql)

      const res = await app.request(`/api/agent/proposals/${PROPOSAL_UUID}`, {
        headers: auth.headers,
      })
      expect(res.status).toBe(404)
    })

    it('404s a malformed id without querying (a slug would 22P02 into a 500)', async () => {
      const { sql } = makeSql({})
      createSql.mockReturnValue(sql)

      const res = await app.request('/api/agent/proposals/not-a-uuid', {
        headers: auth.headers,
      })
      expect(res.status).toBe(404)
      expect(sql).not.toHaveBeenCalled()
    })
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

  it('POST /:id/approve-command stores approval without applying and requires edit authority', async () => {
    const proposalId = '33333333-3333-4333-8333-333333333333'
    const { sql, getStatus } = makeSql({ proposal: { id: proposalId } })
    createSql.mockReturnValue(sql)
    const res = await app.request(`/api/agent/proposals/${proposalId}/approve-command`, {
      method: 'POST',
      headers: { ...auth.headers, 'x-workspace-id': 't_1' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ proposal: { id: proposalId, status: 'accepted', run_id: 'run_1' } })
    expect(getStatus()).toBe('accepted')
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

  /**
   * THE CURATOR PASS (research rec #3). A read-only, advisory verdict a reviewer sees
   * BEFORE deciding: is this candidate well-formed, and does it duplicate / overlap
   * with / contradict something already in memory? Scoped exactly like active-rules.
   */
  it('GET /:id/curator returns a verdict naming the memory this candidate duplicates', async () => {
    const { sql } = makeSql({ proposal: MEMORY_PROPOSAL, memories: [MEMORY_HIT] })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/curator', { headers: auth.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      verdict: {
        outcome: string
        advisory: boolean
        collisions: { memory_id: string; title: string; relation: string }[]
      }
    }
    expect(body.verdict.outcome).toBe('duplicate')
    expect(body.verdict.advisory).toBe(true)
    expect(body.verdict.collisions[0]).toMatchObject({
      memory_id: 'm_existing',
      title: 'Pricing pages ship through the growth review',
      relation: 'duplicate',
    })
  })

  it('GET /:id/curator binds the private lane to the CALLER’s own user id', async () => {
    // The reviewer reading the Inbox is the only identity that may open the personal
    // lane. Binding anyone else's would print a title this viewer is not entitled to.
    const { sql, query } = makeSql({ proposal: MEMORY_PROPOSAL })
    createSql.mockReturnValue(sql)

    await app.request('/api/agent/proposals/p1/curator', { headers: auth.headers })

    const privateCalls = query.mock.calls.filter(([text]) =>
      /visibility = 'private'/.test(String(text)),
    )
    expect(privateCalls.length).toBeGreaterThan(0)
    for (const [, params] of privateCalls) expect(params).toContain('u_approver')
  })

  it('GET /:id/curator falls back to an org-only verdict when no user identity resolves', async () => {
    // An identity gap must degrade the hint, never 500 and never widen the lane.
    const { sql, query } = makeSql({ proposal: MEMORY_PROPOSAL, noUserIdentity: true })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/curator', { headers: auth.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { verdict: { private_lane_skipped: boolean } }
    expect(body.verdict.private_lane_skipped).toBe(true)
    expect(query.mock.calls.some(([text]) => /owner_user_id/.test(String(text)))).toBe(false)
  })

  it('GET /:id/curator is not_applicable for a work-item proposal, and probes nothing', async () => {
    const { sql, query } = makeSql({ memories: [MEMORY_HIT] })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/curator', { headers: auth.headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { verdict: { outcome: string } }
    expect(body.verdict.outcome).toBe('not_applicable')
    expect(query.mock.calls.some(([text]) => /plainto_tsquery/.test(String(text)))).toBe(false)
  })

  it('GET /:id/curator returns 404 when the proposal is not the caller’s', async () => {
    const { sql } = makeSql({ proposalMissing: true })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/curator', { headers: auth.headers })
    expect(res.status).toBe(404)
  })

  it('accepting never consults the curator — a verdict cannot gate a decision', async () => {
    // ADVISORY, structurally. Memory rows are staged so a bad verdict WOULD be
    // available, and the accept path still neither asks for one nor is slowed by one.
    const { sql, query, getStatus } = makeSql({ memories: [MEMORY_HIT] })
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/proposals/p1/accept', {
      method: 'POST',
      headers: auth.headers,
    })
    expect(res.status).toBe(200)
    expect(getStatus()).toBe('applied')
    expect(query.mock.calls.some(([text]) => /plainto_tsquery/.test(String(text)))).toBe(false)
  })

  /**
   * UNDO-ON-ACCEPT. Accepting is only safe if it can be taken back — this endpoint
   * reverses an applied `work_item:update` by writing its pre-image back through
   * the SAME validated write path, and refuses (409, no write) the moment the item
   * has moved since the accept.
   */
  describe('POST /:id/undo', () => {
    const TARGET = '44444444-4444-4444-8444-444444444444'
    /** An applied update whose applied_write carries the pre-image (see proposals/undo.ts). */
    const UNDOABLE = {
      status: 'applied',
      target_type: 'work_item',
      target_id: TARGET,
      operation: 'update',
      payload: { title: 'After' },
      applied_write: {
        ...WI_ROW,
        id: TARGET,
        title: 'After',
        __undo: { pre_image: { title: 'Before' }, applied: { title: 'After' } },
      },
    }

    it('restores the pre-image and reports 200 undone', async () => {
      const { sql } = makeSql({ proposal: UNDOABLE, current: { id: TARGET, title: 'After' } })
      createSql.mockReturnValue(sql)

      const res = await app.request('/api/agent/proposals/p1/undo', { method: 'POST', ...auth })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'undone', proposal_id: 'p1', item_id: TARGET })
    })

    it('reverses through the validated UPDATE path, not a status rollback', async () => {
      const { sql, getStatus, getAppliedWrite } = makeSql({
        proposal: UNDOABLE,
        current: { id: TARGET, title: 'After' },
      })
      createSql.mockReturnValue(sql)

      await app.request('/api/agent/proposals/p1/undo', { method: 'POST', ...auth })
      // A real work_items UPDATE ran…
      const updateCall = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
        (call) => Array.isArray(call[0]) && (call[0] as string[]).join('?').includes('update work_items'),
      )
      expect(updateCall).toBeDefined()
      // …and the proposal is STILL applied — "accepted always means applied" holds.
      expect(getStatus()).toBe('applied')
      const undo = (getAppliedWrite() as Record<string, Record<string, unknown> | undefined>)
        .__undo
      if (!undo) throw new Error('applied_write is missing the undo envelope')
      expect(undo.undone_by).toBe('u_approver')
    })

    it('409s and writes NOTHING when the item changed after the accept', async () => {
      const { sql } = makeSql({
        proposal: UNDOABLE,
        current: { id: TARGET, title: 'edited by someone else' },
      })
      createSql.mockReturnValue(sql)

      const res = await app.request('/api/agent/proposals/p1/undo', { method: 'POST', ...auth })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { status: string; fields: string[] }
      expect(body.status).toBe('conflict')
      expect(body.fields).toEqual(['title'])
      // No later edit was clobbered.
      const updateCall = (sql as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
        (call) => Array.isArray(call[0]) && (call[0] as string[]).join('?').includes('update work_items'),
      )
      expect(updateCall).toBeUndefined()
    })

    it('409s on a second undo of the same proposal', async () => {
      const { sql } = makeSql({ proposal: UNDOABLE, current: { id: TARGET, title: 'After' } })
      createSql.mockReturnValue(sql)

      expect(
        (await app.request('/api/agent/proposals/p1/undo', { method: 'POST', ...auth })).status,
      ).toBe(200)
      expect(
        (await app.request('/api/agent/proposals/p1/undo', { method: 'POST', ...auth })).status,
      ).toBe(409)
    })

    it('422s a create (undoing a create is a delete — out of scope)', async () => {
      const { sql } = makeSql({ current: { id: TARGET } })
      createSql.mockReturnValue(sql)

      const res = await app.request('/api/agent/proposals/p1/undo', { method: 'POST', ...auth })
      expect(res.status).toBe(422)
      expect((await res.json()) as { status: string }).toMatchObject({ status: 'not_undoable' })
    })

    it('404s a proposal outside the caller’s tenants', async () => {
      const { sql } = makeSql({ proposalMissing: true, current: { id: TARGET } })
      createSql.mockReturnValue(sql)

      const res = await app.request('/api/agent/proposals/p1/undo', { method: 'POST', ...auth })
      expect(res.status).toBe(404)
    })

    it('401s without a bearer token (no DB access)', async () => {
      const { sql } = makeSql({ proposal: UNDOABLE, current: { id: TARGET } })
      createSql.mockReturnValue(sql)

      const res = await app.request('/api/agent/proposals/p1/undo', { method: 'POST' })
      expect(res.status).toBe(401)
      expect(sql).not.toHaveBeenCalled()
    })
  })
})
