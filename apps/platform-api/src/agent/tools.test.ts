import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

const { createProposal } = vi.hoisted(() => ({ createProposal: vi.fn() }))
vi.mock('../proposals/repository', () => ({ createProposal }))

// Mock ONLY searchKnowledge (the full RRF/embed pipeline is Task 5's own tested unit);
// keep the real insertKnowledgeAttributions so its raw insert actually hits fakeSql and
// we can assert the XOR-FK params the tool logs.
const { searchKnowledge } = vi.hoisted(() => ({ searchKnowledge: vi.fn() }))
vi.mock('./knowledge-retrieval', async (importActual) => {
  const actual = await importActual<typeof import('./knowledge-retrieval')>()
  return { ...actual, searchKnowledge }
})

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
    searchKnowledge.mockReset()
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

  it('omits search_memory entirely when ctx.holdout=true (no tool path into memory); keeps it when false/omitted', async () => {
    const { sql } = fakeSql([])
    const holdoutTools = buildTools(sql, {
      tenantId: 't_1',
      userId: 'u_1',
      runId: 'run_1',
      modelId: 'm/1',
      holdout: true,
    })
    expect(holdoutTools.search_memory).toBeUndefined()
    expect('search_memory' in holdoutTools).toBe(false)
    // Every other tool is unaffected by holdout.
    expect(holdoutTools.list_work_items).toBeDefined()
    expect(holdoutTools.propose_memory).toBeDefined()

    const treatedTools = buildTools(sql, {
      tenantId: 't_1',
      userId: 'u_1',
      runId: 'run_1',
      modelId: 'm/1',
      holdout: false,
    })
    expect(treatedTools.search_memory).toBeDefined()

    const defaultTools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    expect(defaultTools.search_memory).toBeDefined()
  })

  it('search_knowledge returns items and logs one run_knowledge_attributions row per item, XOR id per kind', async () => {
    // Mixed result set: a memory hit + a chunk hit — the attribution FK must switch by kind.
    const items = [
      { id: 'mem_1', kind: 'memory', title: 'Use PG', tier: 1, score: 0.9, scope: 'org' },
      { id: 'chunk_1', kind: 'chunk', sourceType: 'work_item', title: 'Fixed the timeout', tier: 3, score: 0.5, scope: 'project' },
    ]
    searchKnowledge.mockResolvedValue(items)
    const { sql, query } = fakeSql([])
    const embed = vi.fn()
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1', embed })

    const result = await tools.search_knowledge?.execute?.({ query: 'timeout' }, opts)
    expect(result).toEqual({ items })
    expect(searchKnowledge).toHaveBeenCalledTimes(1)

    // ONE insert into the KB rail, one 8-col tuple per returned item.
    const attr = query.mock.calls.find(([t]) => /run_knowledge_attributions/i.test(String(t)))
    expect(attr).toBeDefined()
    const params = (attr?.[1] ?? []) as unknown[]
    // Columns: run_id, tenant_id, memory_id, chunk_id, kind, rank, score, suppressed.
    // Row 0 (memory) → memory_id set, chunk_id null.
    expect(params.slice(0, 8)).toEqual(['run_1', 't_1', 'mem_1', null, 'memory', 0, 0.9, false])
    // Row 1 (chunk) → chunk_id set, memory_id null.
    expect(params.slice(8, 16)).toEqual(['run_1', 't_1', null, 'chunk_1', 'chunk', 1, 0.5, false])
    // The rka_exactly_one CHECK: every row sets EXACTLY ONE of memory_id/chunk_id.
    for (const [memoryId, chunkId] of [
      [params[2], params[3]],
      [params[10], params[11]],
    ]) {
      expect((memoryId === null) !== (chunkId === null)).toBe(true)
    }
  })

  it('search_knowledge forwards the chat scope so project-scoped chunks are reachable', async () => {
    searchKnowledge.mockResolvedValue([])
    const { sql } = fakeSql([])
    const embed = vi.fn()
    const scope = { workspace: 'w', object: { type: 'project', id: 'p_1', title: 'Launch' } }
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1', embed, scope })

    // Assert the tool is registered before invoking — optional chaining would let
    // this test pass vacuously if search_knowledge (or its execute) went missing.
    const tool = tools.search_knowledge
    expect(tool?.execute).toBeDefined()
    await tool!.execute!({ query: 'x' }, opts)

    expect(searchKnowledge).toHaveBeenCalledWith(sql, expect.objectContaining({ scope }))
  })

  it('search_knowledge is a no-op (no attribution write) when no embed client is bound', async () => {
    searchKnowledge.mockResolvedValue([{ id: 'mem_1', kind: 'memory', title: 'x', tier: 1, score: 1, scope: 'org' }])
    const { sql, query } = fakeSql([])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    const result = await tools.search_knowledge?.execute?.({ query: 'x' }, opts)
    expect(result).toEqual({ items: [] })
    expect(searchKnowledge).not.toHaveBeenCalled()
    expect(query.mock.calls.find(([t]) => /run_knowledge_attributions/i.test(String(t)))).toBeUndefined()
  })

  it('omits search_knowledge entirely on holdout: not registered, never called, zero KB attributions', async () => {
    searchKnowledge.mockResolvedValue([{ id: 'mem_1', kind: 'memory', title: 'x', tier: 1, score: 1, scope: 'org' }])
    const { sql, query } = fakeSql([])
    const embed = vi.fn()
    const holdoutTools = buildTools(sql, {
      tenantId: 't_1',
      userId: 'u_1',
      runId: 'run_1',
      modelId: 'm/1',
      embed,
      holdout: true,
    })
    // The CRITICAL guard: the tool is absent from the toolset (not merely early-returning),
    // so the holdout agent behaves as if the KB tool never existed.
    expect(holdoutTools.search_knowledge).toBeUndefined()
    expect('search_knowledge' in holdoutTools).toBe(false)
    // search_memory is likewise omitted; other tools are unaffected.
    expect(holdoutTools.search_memory).toBeUndefined()
    expect(holdoutTools.list_work_items).toBeDefined()
    // No path to invoke it ⇒ no recall + no KB attribution logging (holdout stays honest).
    expect(searchKnowledge).not.toHaveBeenCalled()
    expect(query.mock.calls.find(([t]) => /run_knowledge_attributions/i.test(String(t)))).toBeUndefined()

    // Present on a treated (non-holdout) run.
    const treated = buildTools(sql, {
      tenantId: 't_1',
      userId: 'u_1',
      runId: 'run_1',
      modelId: 'm/1',
      embed,
      holdout: false,
    })
    expect(treated.search_knowledge).toBeDefined()
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

  it('propose_memory (supersede) drops an empty title/body so the domain keeps the old value', async () => {
    createProposal.mockResolvedValue({ id: 'mprop_blank' })
    const { sql } = fakeSql([{ id: 'mem_9', tenant_id: 't_1' }])
    const tools = buildTools(sql, { tenantId: 't_1', userId: 'u_1', runId: 'run_1', modelId: 'm/1' })
    const result = await tools.propose_memory?.execute?.(
      { operation: 'supersede', target_id: 'mem_9', title: '   ', body: 'Reversed', change_reason: 'Mongo chosen' },
      opts,
    )
    expect(result).toEqual({ proposed: true, proposal_id: 'mprop_blank' })
    const input = createProposal.mock.calls[0]?.[1] as Record<string, unknown>
    // Empty title is omitted entirely (never forwarded as ''); the real body survives.
    expect(input.payload).not.toHaveProperty('title')
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
