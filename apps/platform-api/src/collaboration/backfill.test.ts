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
      'legacy:agent_run:run_1:message:u1',
      'legacy:agent_run:run_1:message:1',
    ])
    expect(first[0]?.references).toEqual([{ kind: 'agent_run', id: 'run_1' }])
  })

  it('keeps dry-run read-only and reports unresolved users without memberships', async () => {
    const query = vi.fn(async (text: string) => {
      if (/from "chat_threads"/i.test(text)) return [{ id: '22222222-2222-4222-8222-222222222222', tenant_id: 't_1', title: 'Legacy' }]
      if (/from "agent_runs"/i.test(text)) return [{ id: 'run_1', triggered_by: 'missing', resolved_user_id: null, transcript: delta }]
      return []
    })
    const report = await runCollaborationBackfill({ query } as never, { apply: false })
    expect(report).toMatchObject({ threads: 1, events: 2, unresolvedUsers: ['missing'], applied: false })
    expect(query.mock.calls.some(([text]) => /insert|update/i.test(String(text)))).toBe(false)
  })

  it('uses conflict-safe deterministic writes so two apply runs converge', async () => {
    const statements: { text: string; params: unknown[] }[] = []
    const query = vi.fn(async (text: string, params: unknown[]) => {
      if (/from "chat_threads"/i.test(text)) return [{ id: '22222222-2222-4222-8222-222222222222', tenant_id: 't_1', title: 'Legacy' }]
      if (/from "agent_runs"/i.test(text)) return [{ id: 'run_1', triggered_by: 'user_1', resolved_user_id: 'user_1', transcript: delta }]
      statements.push({ text, params })
      return [{ id: '22222222-2222-4222-8222-222222222222' }]
    })
    await runCollaborationBackfill({ query } as never, { apply: true })
    await runCollaborationBackfill({ query } as never, { apply: true })
    expect(statements).toHaveLength(2)
    expect(statements[0]?.params).toEqual(statements[1]?.params)
    expect(statements[0]?.text).toMatch(/on conflict[\s\S]*do nothing/i)
    expect(statements[0]?.text).toMatch(/conversation_id/i)
    expect(statements[0]?.text).toMatch(/md5\(event_rows\.idempotency_key\)/i)
  })
})