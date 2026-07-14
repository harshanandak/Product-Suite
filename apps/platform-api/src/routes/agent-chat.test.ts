import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))
const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))
// Mock the AI SDK so the endpoint is proven end-to-end without a live model. The
// propose_create tool still executes for real, driving a real proposals insert.
vi.mock('ai', () => ({
  streamText,
  convertToModelMessages: (m: unknown) => m,
  stepCountIs: (n: number) => ({ type: 'step-count', n }),
  tool: (def: unknown) => def,
}))

import app from '../app'

type MockStreamOpts = {
  tools: { propose_create: { execute: (input: unknown, options: unknown) => Promise<unknown> } }
  onFinish: (event: { text: string; response: { messages: unknown[] }; steps: unknown[] }) => Promise<void>
}

const auth = {
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
}

const body = JSON.stringify({
  messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'create a task' }] }],
})

describe('POST /api/agent/chat', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    streamText.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('runs the agent: prompt → propose_create → a proposal row for the caller tenant, streaming 200', async () => {
    streamText.mockImplementation((opts: MockStreamOpts) => {
      void (async () => {
        await opts.tools.propose_create.execute(
          { title: 'Ship auth', team_id: 'team_1', status_id: 's_1', rationale: 'user asked' },
          { toolCallId: 'call_1', messages: [] },
        )
        await opts.onFinish({
          text: 'Proposed creating the item.',
          response: { messages: [{ role: 'assistant', content: 'done' }] },
          steps: [],
        })
      })()
      return {
        consumeStream: vi.fn(async () => undefined),
        toUIMessageStreamResponse: () => new Response('stream', { status: 200 }),
      }
    })

    // Tagged-template calls resolve the caller: tenants, then user id.
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    // The runtime writes through sql.query(text, params): run mint, proposal, close.
    const sqlQuery = vi.fn(async (text: string, _params?: unknown[]) => {
      if (/insert into "agent_runs"/i.test(text)) return [{ id: 'run_1' }]
      if (/insert into "proposals"/i.test(text)) return [{ id: 'prop_1' }]
      return []
    })
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/chat', { method: 'POST', ...auth, body })
    expect(res.status).toBe(200)

    await vi.waitFor(() => {
      expect(sqlQuery.mock.calls.some(([t]) => /insert into "proposals"/i.test(String(t)))).toBe(true)
    })

    // The proposal is anchored to the caller's resolved tenant and stamped with
    // agent provenance on behalf of the caller — never a client-supplied identity.
    const propose = sqlQuery.mock.calls.find(([t]) => /insert into "proposals"/i.test(String(t)))
    const params = (propose?.[1] ?? []) as unknown[]
    expect(params).toContain('t_1')
    expect(params).toContain('run_1')
    expect(params).toContain('agent')
    expect(params).toContain('u_1')
  })

  it('forwards the object-scoping context into the run system prompt', async () => {
    let captured: { system?: string } | undefined
    streamText.mockImplementation((opts: MockStreamOpts & { system?: string }) => {
      captured = { system: opts.system }
      void opts.onFinish({
        text: 'done',
        response: { messages: [{ role: 'assistant', content: 'done' }] },
        steps: [],
      })
      return {
        consumeStream: vi.fn(async () => undefined),
        toUIMessageStreamResponse: () => new Response('stream', { status: 200 }),
      }
    })

    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    const sqlQuery = vi.fn(async (text: string) =>
      /insert into "agent_runs"/i.test(text) ? [{ id: 'run_1' }] : [],
    )
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        context: { workspace: 'befach-hq', object: { type: 'work_item', id: 'wi_1', title: 'Ship auth' } },
      }),
    })
    expect(res.status).toBe(200)
    expect(captured?.system).toContain('type="work_item"')
    expect(captured?.system).toContain('id="wi_1"')
    expect(captured?.system).toContain('workspace="befach-hq"')
    // The user-authored title is never forwarded into the system prompt.
    expect(captured?.system).not.toContain('Ship auth')
  })

  it('returns 401 without a bearer token (no DB, no model)', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/chat', { method: 'POST', body })
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
    expect(streamText).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is in no org (never starts a run)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([]) // callerTenantIds -> []
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/chat', { method: 'POST', ...auth, body })
    expect(res.status).toBe(403)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('returns 400 when messages are missing (no run started)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/chat', { method: 'POST', ...auth, body: '{}' })
    expect(res.status).toBe(400)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('returns 400 ambiguous when the caller has multiple orgs and no org_id (never starts a run)', async () => {
    const sql = vi.fn()
    sql.mockResolvedValueOnce([{ tenant_id: 't_1' }, { tenant_id: 't_2' }]) // callerTenantIds
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/chat', { method: 'POST', ...auth, body })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Ambiguous organization; specify org_id' })
    expect(streamText).not.toHaveBeenCalled()
  })

  it('returns 400 ambiguous when org_id is not one of the caller’s orgs', async () => {
    const sql = vi.fn()
    sql.mockResolvedValueOnce([{ tenant_id: 't_1' }, { tenant_id: 't_2' }]) // callerTenantIds
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ org_id: 't_9', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    })
    expect(res.status).toBe(400)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('anchors the whole run (and its proposals) to the requested org_id when the caller has multiple orgs', async () => {
    streamText.mockImplementation((opts: MockStreamOpts) => {
      void (async () => {
        await opts.tools.propose_create.execute(
          { title: 'Ship auth', team_id: 'team_1', status_id: 's_1', rationale: 'user asked' },
          { toolCallId: 'call_1', messages: [] },
        )
        await opts.onFinish({
          text: 'done',
          response: { messages: [{ role: 'assistant', content: 'done' }] },
          steps: [],
        })
      })()
      return {
        consumeStream: vi.fn(async () => undefined),
        toUIMessageStreamResponse: () => new Response('stream', { status: 200 }),
      }
    })

    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }, { tenant_id: 't_2' }]) // callerTenantIds
      .mockResolvedValueOnce([{ user_id: 'u_1' }]) // callerUserId
    const sqlQuery = vi.fn(async (text: string, _params?: unknown[]) => {
      if (/insert into "agent_runs"/i.test(text)) return [{ id: 'run_1' }]
      if (/insert into "proposals"/i.test(text)) return [{ id: 'prop_1' }]
      return []
    })
    ;(sql as unknown as { query: typeof sqlQuery }).query = sqlQuery
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ org_id: 't_2', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
    })
    expect(res.status).toBe(200)

    await vi.waitFor(() => {
      expect(sqlQuery.mock.calls.some(([t]) => /insert into "proposals"/i.test(String(t)))).toBe(true)
    })

    // Run minted against the CHOSEN anchor (t_2), and the proposal carries the same
    // tenant — reads, run, and proposal are one consistent org.
    const mint = sqlQuery.mock.calls.find(([t]) => /insert into "agent_runs"/i.test(String(t)))
    expect(mint?.[1]?.[0]).toBe('t_2')
    const propose = sqlQuery.mock.calls.find(([t]) => /insert into "proposals"/i.test(String(t)))
    expect((propose?.[1] ?? []) as unknown[]).toContain('t_2')
  })
})
