import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const conversationId = '22222222-2222-4222-8222-222222222222'
const actorId = '11111111-1111-4111-8111-111111111111'
const targetActorId = '55555555-5555-4555-8555-555555555555'
const eventId = '33333333-3333-4333-8333-333333333333'
const auth = { headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }
const actor = {
  id: actorId,
  tenant_id: 'tenant_1',
  kind: 'human',
  owning_domain: 'identity.user',
  owning_id: 'user_1',
  disabled_at: null,
}
const authorization = {
  actor_id: actorId,
  actor_kind: 'human',
  role: 'writer',
  conversation_status: 'active',
}
const event = {
  id: eventId,
  tenant_id: 'tenant_1',
  conversation_id: conversationId,
  actor_id: actorId,
  sequence: 4,
  idempotency_key: 'request_1',
  kind: 'message.created',
  payload: { text: 'hello' },
  reply_to_event_id: null,
  target_event_id: null,
  references: [{ kind: 'agent_run', id: 'run_1' }],
  created_at: '2026-08-07T00:00:00.000Z',
}

function installSql(options: {
  auth?: typeof authorization | null
  append?: Record<string, unknown>
  membership?: Record<string, unknown>
  list?: Record<string, unknown>[]
  events?: Record<string, unknown>[]
} = {}) {
  const sql = vi.fn()
    .mockResolvedValueOnce([{ tenant_id: 'tenant_1' }])
    .mockResolvedValueOnce([{ user_id: 'user_1' }]) as unknown as {
      (...args: unknown[]): Promise<unknown[]>
      query: ReturnType<typeof vi.fn>
      transaction: ReturnType<typeof vi.fn>
    }
  const query = vi.fn((text: string, _params: unknown[] = []) => {
    if (/membership_write/i.test(text)) return Promise.resolve([options.membership ?? { outcome: 'inserted', semantic_match: true, ...event }])
    if (/with authorized_actor as materialized/i.test(text)) return Promise.resolve([options.append ?? { outcome: 'inserted', ...event }])
    if (/for update/i.test(text)) return Promise.resolve([{ id: conversationId }])
    if (/from "collaboration_actors"\s+where/i.test(text)) return Promise.resolve([actor])
    if (/select a\.id as actor_id/i.test(text)) return Promise.resolve(options.auth === null ? [] : [options.auth ?? authorization])
    if (/from "conversations" c\s+join "conversation_memberships"/i.test(text)) return Promise.resolve(options.list ?? [{ id: conversationId, tenant_id: 'tenant_1', title: 'Launch', status: 'active' }])
    if (/from "conversations"\s+where/i.test(text)) return Promise.resolve(options.list ?? [{ id: conversationId, tenant_id: 'tenant_1', title: 'Launch', status: 'active' }])
    if (/from "conversation_events"[\s\S]*sequence\s*>/i.test(text)) return Promise.resolve(options.events ?? [event])
    return Promise.resolve([])
  })
  const transaction = vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries))
  sql.query = query
  sql.transaction = transaction
  createSql.mockReturnValue(sql)
  return { sql, query, transaction }
}

describe('canonical conversation routes', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('registers an authenticated tenant-scoped conversation list', async () => {
    const { query } = installSql()
    const res = await app.request('/api/conversations?tenant_id=tenant_1', auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: conversationId, tenant_id: 'tenant_1', title: 'Launch', status: 'active' }])
    const list = query.mock.calls.find(([text]) => /from "conversations" c\s+join "conversation_memberships"/i.test(String(text)))
    expect(String(list?.[0])).toMatch(/c\.updated_at\s*<\s*\$3::timestamptz[\s\S]*order by c\.updated_at desc[\s\S]*limit \$4/i)
    expect(list?.[1]).toEqual(['tenant_1', actorId, null, 50])
  })

  it('applies a bounded updated_at keyset cursor to conversation lists', async () => {
    const { query } = installSql()
    const cursor = '2026-08-07T00:00:00.000Z'
    const res = await app.request(`/api/conversations?tenant_id=tenant_1&before_updated_at=${encodeURIComponent(cursor)}&limit=25`, auth)
    expect(res.status).toBe(200)
    const list = query.mock.calls.find(([text]) => /from "conversations" c\s+join "conversation_memberships"/i.test(String(text)))
    expect(list?.[1]).toEqual(['tenant_1', actorId, cursor, 25])
  })

  it('rejects invalid list bounds and cursors before DB access', async () => {
    const { query } = installSql()
    const responses = await Promise.all([
      app.request('/api/conversations?tenant_id=tenant_1&limit=101', auth),
      app.request('/api/conversations?tenant_id=tenant_1&before_updated_at=not-a-date', auth),
    ])
    expect(responses.map((response) => response.status)).toEqual([400, 400])
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 404 for a foreign conversation without leaking it', async () => {
    installSql({ auth: null })
    const res = await app.request(`/api/conversations/${conversationId}?tenant_id=tenant_1`, auth)
    expect(res.status).toBe(404)
  })

  it('reads events from an exclusive cursor and round-trips owning references', async () => {
    const { query } = installSql({ events: [{ ...event, sequence: 5 }] })
    const res = await app.request(`/api/conversations/${conversationId}/events?tenant_id=tenant_1&after_sequence=4`, auth)
    expect(res.status).toBe(200)
    const body = await res.json() as { events: typeof event[] }
    expect(body.events[0]).toMatchObject({ sequence: 5, references: [{ kind: 'agent_run', id: 'run_1' }] })
    const read = query.mock.calls.find(([text]) => /sequence\s*>/i.test(String(text)))
    expect(read?.[1]).toEqual(['tenant_1', conversationId, 4, 100])
  })

  it('rejects actor spoofing instead of silently stripping it', async () => {
    const { transaction } = installSql()
    const res = await app.request(`/api/conversations/${conversationId}/events`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', idempotency_key: 'request_1', kind: 'message.created',
        payload: { text: 'hello' }, actor_id: targetActorId,
      }),
    })
    expect(res.status).toBe(400)
    expect(transaction).not.toHaveBeenCalled()
  })


it('rejects secret-bearing payload fields before append', async () => {
    const { transaction } = installSql()
    const res = await app.request(`/api/conversations/${conversationId}/events`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', idempotency_key: 'request_1', kind: 'message.created',
        payload: { access_token: 'must-not-persist' },
      }),
    })
    expect(res.status).toBe(400)
    expect(transaction).not.toHaveBeenCalled()
  })
  it.each([
    { accessToken: 'must-not-persist' },
    { nested: { clientSecret: 'must-not-persist' } },
    { apiKey: 'must-not-persist' },
  ])('rejects camelCase secret-bearing payload fields', async (payload) => {
    const { transaction } = installSql()
    const res = await app.request(`/api/conversations/${conversationId}/events`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', idempotency_key: 'request_1', kind: 'message.created', payload,
      }),
    })
    expect(res.status).toBe(400)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('fails closed when a payload exceeds the sensitive-key scan depth', async () => {
    const { transaction } = installSql()
    let payload: Record<string, unknown> = { value: 'leaf' }
    for (let depth = 0; depth < 25; depth += 1) payload = { nested: payload }
    const res = await app.request(`/api/conversations/${conversationId}/events`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', idempotency_key: 'request_1', kind: 'message.created', payload,
      }),
    })
    expect(res.status).toBe(400)
    expect(transaction).not.toHaveBeenCalled()
  })
  it('maps changed idempotent retries to 409', async () => {
    installSql({ append: { outcome: 'existing', ...event } })
    const res = await app.request(`/api/conversations/${conversationId}/events`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', idempotency_key: 'request_1', kind: 'message.created', payload: { text: 'changed' },
      }),
    })
    expect(res.status).toBe(409)
  })

  it('requires admin before a membership mutation', async () => {
    const { transaction } = installSql({ auth: { ...authorization, role: 'writer' } })
    const res = await app.request(`/api/conversations/${conversationId}/memberships`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', target_actor_id: targetActorId, role: 'reader', status: 'active', idempotency_key: 'member_1',
      }),
    })
    expect(res.status).toBe(403)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('returns an existing membership retry after the conversation is archived', async () => {
    installSql({
      auth: { ...authorization, role: 'admin', conversation_status: 'archived' },
      membership: { outcome: 'existing', semantic_match: true, ...event },
    })
    const res = await app.request(`/api/conversations/${conversationId}/memberships`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', target_actor_id: targetActorId, role: 'reader', status: 'active', idempotency_key: 'member_1',
      }),
    })
    expect(res.status).toBe(200)
  })


it('mutates membership and appends its audit event in one locked transaction for an admin', async () => {
    const { query, transaction } = installSql({ auth: { ...authorization, role: 'admin' } })
    const res = await app.request(`/api/conversations/${conversationId}/memberships`, {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        tenant_id: 'tenant_1', target_actor_id: targetActorId, role: 'reader', status: 'active', idempotency_key: 'member_1',
      }),
    })
    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledOnce()
    const statement = String(query.mock.calls.find(([text]) => /membership_write/i.test(String(text)))?.[0])
    expect(statement).toMatch(/next_sequence\s*=\s*c\.next_sequence\s*\+\s*1/i)
    expect(statement).toMatch(/insert into "conversation_memberships"/i)
    expect(statement).toMatch(/insert into "conversation_events"/i)
    expect(statement.indexOf("when e.id is not null then 'existing'")).toBeLessThan(
      statement.indexOf("when a.conversation_status = 'archived' then 'archived'"),
    )
  })
  it('authenticates every canonical route before DB access', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const responses = await Promise.all([
      app.request('/api/conversations?tenant_id=tenant_1'),
      app.request(`/api/conversations/${conversationId}?tenant_id=tenant_1`),
      app.request(`/api/conversations/${conversationId}/events?tenant_id=tenant_1`),
      app.request(`/api/conversations/${conversationId}/events`, { method: 'POST' }),
      app.request(`/api/conversations/${conversationId}/memberships`, { method: 'POST' }),
    ])
    expect(responses.map((res) => res.status)).toEqual([401, 401, 401, 401, 401])
    expect(sql).not.toHaveBeenCalled()
  })
})
