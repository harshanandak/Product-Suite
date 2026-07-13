import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'
import type { LanguageModel, UIMessage } from 'ai'

// Mock the AI SDK so the loop is fully deterministic without a live model. The
// tool `execute` still runs for real (driving a real proposals insert), and we
// drive `onFinish` ourselves — proving prompt → tool → proposal + run lifecycle
// entirely offline. `tool` is passed through so buildTools still wires executes.
const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }))
vi.mock('ai', () => ({
  streamText,
  convertToModelMessages: (m: unknown) => m,
  stepCountIs: (n: number) => ({ type: 'step-count', n }),
  tool: (def: unknown) => def,
}))

import { runAgentChat } from './runtime'

type MockStreamOpts = {
  tools: { propose_create: { execute: (input: unknown, options: unknown) => Promise<unknown> } }
  onFinish: (event: { text: string; response: { messages: unknown[] }; steps: unknown[] }) => Promise<void>
}

function fakeSql() {
  const query = vi.fn(async (text: string, _params: unknown[]) => {
    if (/insert into "agent_runs"/i.test(text)) return [{ id: 'run_1' }]
    if (/insert into "proposals"/i.test(text)) return [{ id: 'prop_1' }]
    return []
  })
  const sql = vi.fn() as unknown as Sql
  ;(sql as unknown as { query: typeof query }).query = query
  return { sql, query }
}

const fakeModel = { modelId: 'x/y' } as unknown as LanguageModel

describe('runAgentChat (request-free runtime + agent_runs lifecycle)', () => {
  beforeEach(() => {
    streamText.mockReset()
  })

  it('mints a run, executes propose_create → a real proposal insert, and completes with a transcript', async () => {
    streamText.mockImplementation((opts: MockStreamOpts) => {
      // Simulate the model choosing to propose, then the stream settling.
      void (async () => {
        await opts.tools.propose_create.execute(
          { title: 'Ship auth', team_id: 'team_1', status_id: 's_1', rationale: 'user asked' },
          { toolCallId: 'call_1', messages: [] },
        )
        await opts.onFinish({
          text: 'Proposed creating the item.',
          response: { messages: [{ role: 'assistant', content: 'Proposed creating the item.' }] },
          steps: [{ toolCalls: [{ toolName: 'propose_create' }] }],
        })
      })()
      return { toUIMessageStreamResponse: () => new Response('ok', { status: 200 }) }
    })

    const { sql, query } = fakeSql()
    const messages = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'create a task' }] },
    ] as unknown as UIMessage[]

    const res = await runAgentChat(
      sql,
      { tenantIds: ['t_1'], tenantId: 't_1', userId: 'u_1', model: fakeModel },
      messages,
    )
    // Streams back to the caller immediately (request-free: no Request threaded in).
    expect(res.status).toBe(200)

    // Wait for the fire-and-forget tool-exec + onFinish persistence to settle.
    await vi.waitFor(() => {
      expect(query.mock.calls.some(([t]) => /insert into "proposals"/i.test(String(t)))).toBe(true)
      expect(query.mock.calls.some(([t]) => /update "agent_runs"/i.test(String(t)))).toBe(true)
    })

    // (a) Run minted first, anchored to the resolved tenant + human trigger.
    const mint = query.mock.calls.find(([t]) => /insert into "agent_runs"/i.test(String(t)))
    expect(mint?.[1]).toEqual(['t_1', 'u_1'])

    // (b) The tool wrote ONLY a proposal, stamped with agent provenance + the run id.
    const propose = query.mock.calls.find(([t]) => /insert into "proposals"/i.test(String(t)))
    const proposeParams = (propose?.[1] ?? []) as unknown[]
    expect(proposeParams).toContain('run_1') // run_id / actor_id / context_ref
    expect(proposeParams).toContain('agent') // actor_type
    expect(proposeParams).toContain('u_1') // on_behalf_of

    // (c) Run closed 'completed' with the transcript persisted for the decision corpus.
    const close = query.mock.calls.find(([t]) => /update "agent_runs"/i.test(String(t)))
    const closeParams = (close?.[1] ?? []) as unknown[]
    expect(closeParams[0]).toBe('completed')
    expect(closeParams[3]).toBe('run_1')
    expect(String(closeParams[2])).toContain('Proposed creating the item.')
  })
})
