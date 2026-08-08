import { describe, expect, it, vi } from 'vitest'

import { legacyEventsForRun, runCollaborationBackfill } from './backfill'

const delta = {
  version: 1,
  messages: [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
  ],
}

describe('platform thread collaboration backfill', () => {
  it('skips v0 and creates deterministic v1 keys, order, and run references', () => {
    expect(legacyEventsForRun('run_1', { messages: [] }, 4)).toEqual([])
    const first = legacyEventsForRun('run_1', delta, 4)
    const second = legacyEventsForRun('run_1', delta, 4)
    expect(first).toEqual(second)
    expect(first.map((event) => event.sequence)).toEqual([4, 5])
    expect(first.map((event) => event.idempotencyKey)).toEqual([
      'legacy:agent_run:run_1:message:id:u1',
      'legacy:agent_run:run_1:message:index:1',
    ])
    expect(first[0]?.references).toEqual([{ kind: 'agent_run', id: 'run_1' }])
  })

  it('namespaces message ids and fallback indexes so their keys cannot collide', () => {
    const events = legacyEventsForRun(
      'run_1',
      { version: 1, messages: [{ id: '1' }, {}] },
      1,
    )

    expect(events.map((event) => event.idempotencyKey)).toEqual([
      'legacy:agent_run:run_1:message:id:1',
      'legacy:agent_run:run_1:message:index:1',
    ])
    expect(new Set(events.map((event) => event.idempotencyKey))).toHaveLength(2)
  })

  it('keeps dry-run read-only and reports unresolved users without memberships', async () => {
    const query = vi.fn(async (text: string, params: unknown[]) => {
      if (/from "chat_threads"/i.test(text)) return params[0] === null
        ? [{ id: '22222222-2222-4222-8222-222222222222', tenant_id: 't_1', created_at: '2026-01-01T00:00:00.000Z', title: 'Legacy' }]
        : []
      if (/from "agent_runs"/i.test(text)) return [{ id: 'run_1', triggered_by: 'missing', resolved_user_id: null, transcript: delta }]
      return []
    })
    const report = await runCollaborationBackfill({ query } as never, { apply: false })
    expect(report).toMatchObject({ threads: 1, events: 2, unresolvedUsers: ['missing'], applied: false })
    expect(query.mock.calls.some(([text]) => /insert|update/i.test(String(text)))).toBe(false)
  })

  it('emits identical conflict-safe deterministic writes for repeated apply runs', async () => {
    const statements: { text: string; params: unknown[] }[] = []
    const query = vi.fn(async (text: string, params: unknown[]) => {
      if (/from "chat_threads"/i.test(text)) return params[0] === null
        ? [{ id: '22222222-2222-4222-8222-222222222222', tenant_id: 't_1', created_at: '2026-01-01T00:00:00.000Z', title: 'Legacy' }]
        : []
      if (/from "agent_runs"/i.test(text)) return [{ id: 'run_1', triggered_by: 'user_1', resolved_user_id: 'user_1', transcript: delta }]
      statements.push({ text, params })
      if (/insert into "collaboration_actors"/i.test(text)) return [{ id: 'service_1', disabled_at: null }]
      return [{ id: '22222222-2222-4222-8222-222222222222' }]
    })
    await runCollaborationBackfill({ query } as never, { apply: true })
    await runCollaborationBackfill({ query } as never, { apply: true })
    expect(statements).toHaveLength(4)
    expect(statements[0]?.params).toEqual(statements[2]?.params)
    expect(statements[1]?.params).toEqual(statements[3]?.params)
    expect(statements[0]?.text).toMatch(/insert into "collaboration_actors"/i)
    expect(statements[0]?.text).not.toMatch(/insert into "conversations"/i)
    expect(statements[1]?.text).not.toMatch(/insert into "collaboration_actors"/i)
    expect(statements[1]?.text).toMatch(/on conflict[\s\S]*do nothing/i)
    expect(statements[1]?.text).toMatch(/conversation_id/i)
    expect(statements[1]?.text).toMatch(/md5\(event_rows\.idempotency_key\)/i)
    expect(statements[1]?.text).toMatch(/from conversation_write\s+cross join service_actor\s+cross join user_rows/i)
    expect(statements[1]?.text).not.toMatch(/from conversation_write\s*,/i)
  })

  it('fails the apply when the migration service actor is disabled', async () => {
    const query = vi.fn(async (text: string, params: unknown[]) => {
      if (/from "chat_threads"/i.test(text)) return params[0] === null
        ? [{ id: '22222222-2222-4222-8222-222222222222', tenant_id: 't_1', created_at: '2026-01-01T00:00:00.000Z', title: 'Legacy' }]
        : []
      if (/from "agent_runs"/i.test(text)) return [{ id: 'run_1', triggered_by: null, resolved_user_id: null, transcript: delta }]
      if (/insert into "collaboration_actors"/i.test(text)) return [{ id: 'service_1', disabled_at: '2026-08-08T00:00:00.000Z' }]
      return [{ id: '22222222-2222-4222-8222-222222222222' }]
    })

    await expect(runCollaborationBackfill({ query } as never, { apply: true })).rejects.toThrow(
      'Collaboration backfill service actor is disabled for tenant t_1',
    )
    expect(query.mock.calls.some(([text]) => /insert into "conversations"/i.test(String(text)))).toBe(false)
  })

  it('reads bounded keyset pages and reports the last successfully processed cursor', async () => {
    const first = { id: '11111111-1111-4111-8111-111111111111', tenant_id: 't_1', created_at: '2026-01-01T00:00:00.000Z', title: 'First' }
    const second = { id: '22222222-2222-4222-8222-222222222222', tenant_id: 't_1', created_at: '2026-01-02T00:00:00.000Z', title: 'Second' }
    const third = { id: '33333333-3333-4333-8333-333333333333', tenant_id: 't_2', created_at: '2026-01-01T00:00:00.000Z', title: 'Third' }
    const pageQueries: unknown[][] = []
    const query = vi.fn(async (text: string, params: unknown[]) => {
      if (/from "chat_threads"/i.test(text)) {
        pageQueries.push(params)
        if (params[0] === null) return [first, second]
        if (params[2] === second.id) return [third]
        return []
      }
      if (/from "agent_runs"/i.test(text)) return []
      return []
    })

    const report = await runCollaborationBackfill({ query } as never, { apply: false, pageSize: 2 })

    expect(pageQueries).toEqual([
      [null, null, null, 2],
      ['t_1', second.created_at, second.id, 2],
    ])
    expect(report).toMatchObject({
      threads: 3,
      lastSuccessfulCursor: { tenantId: 't_2', createdAt: third.created_at, id: third.id },
    })
  })

  it('resumes strictly after the supplied keyset cursor', async () => {
    const cursor = {
      tenantId: 't_1',
      createdAt: '2026-01-02T00:00:00.000Z',
      id: '22222222-2222-4222-8222-222222222222',
    }
    const query = vi.fn(async (_text: string, _params: unknown[]) => {
      return []
    })

    const report = await runCollaborationBackfill({ query } as never, { apply: false, cursor })

    expect(query).toHaveBeenCalledWith(expect.stringMatching(/\(tenant_id, created_at, id\) >/i), [
      cursor.tenantId,
      cursor.createdAt,
      cursor.id,
      100,
    ])
    expect(report.lastSuccessfulCursor).toEqual(cursor)
  })

  it('rejects unbounded page sizes before querying', async () => {
    const query = vi.fn()

    await expect(runCollaborationBackfill({ query } as never, { apply: false, pageSize: 1001 })).rejects.toThrow(
      'Collaboration backfill pageSize must be between 1 and 1000',
    )
    expect(query).not.toHaveBeenCalled()
  })
})
