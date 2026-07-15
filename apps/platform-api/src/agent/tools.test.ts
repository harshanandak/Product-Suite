import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

const { createProposal } = vi.hoisted(() => ({ createProposal: vi.fn() }))
vi.mock('../proposals/repository', () => ({ createProposal }))

import { buildTools } from './tools'

/** Minimal valid ToolCallOptions the AI SDK passes to every execute(). */
const opts = { toolCallId: 'test-call', messages: [] }

function fakeSql(rows: unknown[]) {
  const query = vi.fn(async (_text: string, _params: unknown[]) => rows)
  const sql = vi.fn(async () => rows) as unknown as Sql
  ;(sql as unknown as { query: typeof query }).query = query
  return { sql, query }
}

describe('buildTools (ToolRegistry)', () => {
  beforeEach(() => {
    createProposal.mockReset()
  })

  it('propose_create writes ONLY a proposal, stamped with agent provenance', async () => {
    createProposal.mockResolvedValue({ id: 'prop_1' })
    const { sql, query } = fakeSql([])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'z-ai/glm-4.7' })

    const execute = tools.propose_create?.execute
    expect(execute).toBeDefined()
    const result = await execute?.(
      { title: 'New item', team_id: 'team_1', status_id: 's_1', priority: 'high', rationale: 'because' },
      opts,
    )

    // The tool never touches a real table — only the proposals queue.
    expect(query).not.toHaveBeenCalled()
    expect(result).toEqual({ proposed: true, proposal_id: 'prop_1' })
    expect(createProposal).toHaveBeenCalledTimes(1)

    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    // Provenance is server-derived: the RUN is the actor, the human authorizes it,
    // the proposal is anchored to the run's single tenant, and everything is stamped
    // with the run id + model + prompt version for the decision corpus.
    expect(input).toMatchObject({
      tenant_id: 't_1',
      run_id: 'run_1',
      target_type: 'work_item',
      operation: 'create',
      actor_type: 'agent',
      actor_id: 'run_1',
      on_behalf_of: 'u_1',
      context_ref: 'run_1',
      rationale: 'because',
      model_id: 'z-ai/glm-4.7',
      prompt_version: 'agent-v1',
    })
    expect(input.payload).toMatchObject({ title: 'New item', team_id: 'team_1', status_id: 's_1', priority: 'high' })
  })

  it('anchors the proposal to the run tenant and never streams raw DB errors to the model', async () => {
    // A DB failure must surface to the model as a GENERIC refusal, not internals.
    createProposal.mockRejectedValue(new Error('duplicate key value violates unique constraint "proposals_pkey"'))
    const { sql } = fakeSql([])
    const tools = buildTools(sql, { tenantId: 't_anchor', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })

    const result = await tools.propose_create?.execute?.(
      { title: 'X', team_id: 'team_1', status_id: 's_1' },
      opts,
    )
    expect(result).toEqual({ proposed: false, error: 'could not create proposal' })
    // The attempt was still anchored to the run's single tenant, not a random one.
    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input.tenant_id).toBe('t_anchor')
  })

  it('propose_update targets the item id and carries the patch as payload', async () => {
    createProposal.mockResolvedValue({ id: 'prop_2' })
    const { sql } = fakeSql([])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })

    const result = await tools.propose_update?.execute?.(
      { id: 'wi_9', patch: { priority: 'critical' }, rationale: 'urgent' },
      opts,
    )
    expect(result).toEqual({ proposed: true, proposal_id: 'prop_2' })
    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input).toMatchObject({
      operation: 'update',
      target_type: 'work_item',
      target_id: 'wi_9',
      actor_type: 'agent',
      on_behalf_of: 'u_1',
    })
    expect(input.payload).toEqual({ priority: 'critical' })
  })

  it('search_memory returns compact hits and logs one attribution per hit (injected_via=tool)', async () => {
    const memHits = [
      { id: 'mem_1', kind: 'decision', title: 'Use PG', status: 'active', topics: ['db'], root_id: 'mem_1' },
    ]
    const query = vi.fn(async (text: string, _params: unknown[]) =>
      /from "memories"/i.test(text) ? memHits : [],
    )
    const sql = vi.fn() as unknown as Sql
    ;(sql as unknown as { query: typeof query }).query = query
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })

    const result = await tools.search_memory?.execute?.({ query: 'pg' }, opts)
    expect(result).toEqual({ hits: memHits })
    // The moat rail: one attribution per returned memory, stamped injected_via='tool'.
    const attr = query.mock.calls.find(([t]) => /run_memory_attributions/i.test(String(t)))
    expect(attr).toBeDefined()
    const params = (attr?.[1] ?? []) as unknown[]
    expect(params.slice(0, 4)).toEqual(['run_1', 'mem_1', 't_1', 'tool'])
  })

  it('propose_memory (create) writes a target_type=memory proposal with agent provenance', async () => {
    createProposal.mockResolvedValue({ id: 'mprop_1' })
    // A create has no target, so no ownership lookup runs — query stays untouched.
    const { sql, query } = fakeSql([])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })

    const result = await tools.propose_memory?.execute?.(
      {
        operation: 'create',
        kind: 'decision',
        title: 'Use Postgres',
        body: 'We picked PG over Mongo.',
        topics: ['db'],
        rationale: 'Recorded on the call.',
      },
      opts,
    )

    expect(result).toEqual({ proposed: true, proposal_id: 'mprop_1' })
    expect(query).not.toHaveBeenCalled() // never touches a real table
    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input).toMatchObject({
      tenant_id: 't_1',
      run_id: 'run_1',
      target_type: 'memory',
      target_id: null,
      operation: 'create',
      actor_type: 'agent',
      actor_id: 'run_1',
      on_behalf_of: 'u_1',
      context_ref: 'run_1',
      model_id: 'm/1',
      prompt_version: 'agent-v1',
    })
    expect(input.payload).toMatchObject({
      kind: 'decision',
      title: 'Use Postgres',
      body: 'We picked PG over Mongo.',
      topics: ['db'],
    })
  })

  it('propose_memory (create) rejects a missing title (proposed:false, no proposal written)', async () => {
    const { sql } = fakeSql([])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    const result = await tools.propose_memory?.execute?.({ operation: 'create', kind: 'fact' }, opts)
    expect(result).toMatchObject({ proposed: false })
    expect(createProposal).not.toHaveBeenCalled()
  })

  it('propose_memory (supersede) targets a caller-org memory and requires a change_reason', async () => {
    createProposal.mockResolvedValue({ id: 'mprop_2' })
    // The ownership check finds the target in the caller's org.
    const { sql } = fakeSql([{ id: 'mem_9', tenant_id: 't_1' }])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })

    // Missing change_reason → refused, no proposal.
    const bad = await tools.propose_memory?.execute?.(
      { operation: 'supersede', target_id: 'mem_9', title: 'New' },
      opts,
    )
    expect(bad).toMatchObject({ proposed: false })
    expect(createProposal).not.toHaveBeenCalled()

    const result = await tools.propose_memory?.execute?.(
      { operation: 'supersede', target_id: 'mem_9', body: 'Reversed', change_reason: 'Mongo chosen' },
      opts,
    )
    expect(result).toEqual({ proposed: true, proposal_id: 'mprop_2' })
    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input).toMatchObject({
      target_type: 'memory',
      operation: 'supersede',
      target_id: 'mem_9',
      actor_type: 'agent',
    })
    expect(input.payload).toMatchObject({ body: 'Reversed', change_reason: 'Mongo chosen' })
  })

  it('propose_memory rejects a FOREIGN supersede target (tenant isolation — never proposed)', async () => {
    // The ownership check returns nothing → the target is not the caller-org's memory.
    const { sql } = fakeSql([])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    const result = await tools.propose_memory?.execute?.(
      { operation: 'supersede', target_id: 'foreign_mem', change_reason: 'x' },
      opts,
    )
    expect(result).toMatchObject({ proposed: false })
    expect(createProposal).not.toHaveBeenCalled()
  })

  it('propose_memory (retract/defer) targets a caller-org memory', async () => {
    createProposal.mockResolvedValue({ id: 'mprop_3' })
    const { sql } = fakeSql([{ id: 'mem_9', tenant_id: 't_1' }])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    const result = await tools.propose_memory?.execute?.(
      { operation: 'defer', target_id: 'mem_9', waiting_on: 'legal' },
      opts,
    )
    expect(result).toEqual({ proposed: true, proposal_id: 'mprop_3' })
    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input).toMatchObject({ target_type: 'memory', operation: 'defer', target_id: 'mem_9' })
    expect(input.payload).toMatchObject({ waiting_on: 'legal' })
  })

  it('propose_memory (defer) rejects a free-form review_after (proposed:false, no proposal written)', async () => {
    // Guard the wedge at the tool: a non-ISO review_after must never become a queued
    // proposal that cast-errors (500) on accept.
    const { sql } = fakeSql([{ id: 'mem_9', tenant_id: 't_1' }])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    const result = await tools.propose_memory?.execute?.(
      { operation: 'defer', target_id: 'mem_9', review_after: 'next quarter' },
      opts,
    )
    expect(result).toMatchObject({ proposed: false })
    expect(createProposal).not.toHaveBeenCalled()
  })

  it('propose_memory (defer) accepts a valid ISO review_after and forwards it', async () => {
    createProposal.mockResolvedValue({ id: 'mprop_iso' })
    const { sql } = fakeSql([{ id: 'mem_9', tenant_id: 't_1' }])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    const result = await tools.propose_memory?.execute?.(
      { operation: 'defer', target_id: 'mem_9', review_after: '2026-08-01' },
      opts,
    )
    expect(result).toEqual({ proposed: true, proposal_id: 'mprop_iso' })
    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input.payload).toMatchObject({ review_after: '2026-08-01' })
  })

  it('list_work_items scopes by ctx.tenantIds and returns compact fields only', async () => {
    const { sql, query } = fakeSql([
      {
        id: 'wi_1',
        title: 'T',
        status_id: 's_1',
        priority: 'high',
        team_id: 'team_1',
        description: 'body that must not leak',
        tenant_id: 't_1',
      },
    ])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })

    const result = await tools.list_work_items?.execute?.({ limit: 10 }, opts)
    expect(result).toEqual([
      { id: 'wi_1', title: 'T', status_id: 's_1', priority: 'high', team_id: 'team_1' },
    ])
    // Never writes; reads are scoped to the run's SINGLE anchored org (equality,
    // not any(...)), so reads and proposals share one consistent tenant.
    expect(createProposal).not.toHaveBeenCalled()
    const [text, params] = query.mock.calls[0] ?? []
    expect(String(text)).toMatch(/work_items/i)
    expect(String(text)).toMatch(/tenant_id = \$1/i)
    expect(params?.[0]).toBe('t_1')
  })
})
