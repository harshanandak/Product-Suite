import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { rrfFuse, searchKnowledge, tierWeight, type EmbedFn } from './knowledge-retrieval'

// ---------------------------------------------------------------------------
// rrfFuse (pure) — determinism, multi-list boost, id tie-break.
// ---------------------------------------------------------------------------

describe('rrfFuse (pure)', () => {
  it('scores by Σ1/(k+rank), sorts desc, deterministic for fixed inputs', () => {
    const fused = rrfFuse([
      [
        { id: 'a', rank: 0 },
        { id: 'b', rank: 1 },
      ],
      [
        { id: 'c', rank: 0 },
        { id: 'a', rank: 1 },
      ],
    ])
    // a = 1/60 + 1/61 (two lists) > c = 1/60 > b = 1/61
    expect(fused.map((f) => f.id)).toEqual(['a', 'c', 'b'])
  })

  it('an item ranked high in TWO lists beats one ranked high in ONE', () => {
    const fused = rrfFuse([
      [{ id: 'a', rank: 0 }],
      [{ id: 'a', rank: 0 }],
      [{ id: 'd', rank: 0 }],
    ])
    expect(fused[0]!.id).toBe('a')
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score)
    expect(fused[1]!.id).toBe('d')
  })

  it('breaks exact score ties by id ascending (fully deterministic)', () => {
    const fused = rrfFuse([[{ id: 'y', rank: 0 }], [{ id: 'x', rank: 0 }]])
    expect(fused.map((f) => f.id)).toEqual(['x', 'y'])
  })

  it('tierWeight is strictly decreasing so a lower tier outranks at equal relevance', () => {
    expect(tierWeight(1)).toBeGreaterThan(tierWeight(3))
  })
})

// ---------------------------------------------------------------------------
// searchKnowledge — mocked sql + embed.
// ---------------------------------------------------------------------------

interface Lanes {
  knnChunks?: unknown[]
  ftsChunks?: unknown[]
  knnMem?: unknown[]
  ftsMem?: unknown[]
}

function laneOf(text: string): keyof Lanes {
  const isChunks = text.includes('knowledge_chunks')
  const isKnn = text.includes('<=>')
  if (isChunks && isKnn) return 'knnChunks'
  if (isChunks) return 'ftsChunks'
  if (isKnn) return 'knnMem'
  return 'ftsMem'
}

function mockSql(lanes: Lanes) {
  const texts: string[] = []
  const query = vi.fn(async (text: string, _params: unknown[]) => {
    texts.push(text)
    return lanes[laneOf(text)] ?? []
  })
  const sql = { query } as unknown as Sql
  return { sql, query, texts }
}

const okEmbed: EmbedFn = async () => ({ vectors: [[0.1, 0.2, 0.3]], model: 'm', dims: 3 })

function chunkRow(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    source_type: 'work_item',
    content: 'How we solved the flaky checkout test',
    tier: 3,
    scope_type: 'project',
    event_time: null,
    embedding: null,
    ...over,
  }
}

function memRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    kind: 'decision',
    title: 'Use Postgres for the ledger',
    body: 'ACID + one datastore',
    scope_type: 'org',
    pinned: false,
    enforcement: 'advisory',
    priority: 0,
    valid_from: null,
    embedding: null,
    ...over,
  }
}

describe('searchKnowledge', () => {
  it('returns memories AND chunks fused into one ranked set', async () => {
    const { sql } = mockSql({ knnChunks: [chunkRow()], ftsMem: [memRow()] })
    const out = await searchKnowledge(sql, { tenantId: 't1', query: 'checkout', k: 10, embed: okEmbed })
    const kinds = out.map((i) => i.kind).sort()
    expect(kinds).toEqual(['chunk', 'memory'])
    expect(out.find((i) => i.kind === 'chunk')!.sourceType).toBe('work_item')
  })

  it('a T1 memory outranks a same-relevance T3 chunk (tier weight)', async () => {
    // Memory in both memory lanes, chunk in both chunk lanes → equal fused score.
    const { sql } = mockSql({
      knnChunks: [chunkRow()],
      ftsChunks: [chunkRow()],
      knnMem: [memRow()],
      ftsMem: [memRow()],
    })
    const out = await searchKnowledge(sql, { tenantId: 't1', query: 'x', k: 10, embed: okEmbed })
    expect(out[0]!.id).toBe('m1')
    expect(out[0]!.kind).toBe('memory')
    expect(out[0]!.tier).toBe(1)
    expect(out[1]!.id).toBe('c1')
    expect(out[1]!.tier).toBe(3)
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score)
  })

  it('embed failure → FTS-only mode (no throw, still returns, no kNN issued)', async () => {
    const failEmbed: EmbedFn = async () => {
      throw new Error('provider down')
    }
    const { sql, texts } = mockSql({ ftsChunks: [chunkRow()], ftsMem: [memRow()] })
    const out = await searchKnowledge(sql, { tenantId: 't1', query: 'ledger', k: 10, embed: failEmbed })
    expect(out.length).toBe(2)
    expect(texts.some((t) => t.includes('<=>'))).toBe(false)
  })

  it('holdout=true → chunk lane only (no memory rows, no memory queries)', async () => {
    const { sql, texts } = mockSql({
      knnChunks: [chunkRow()],
      ftsChunks: [chunkRow()],
      knnMem: [memRow()],
      ftsMem: [memRow()],
    })
    const out = await searchKnowledge(sql, { tenantId: 't1', query: 'x', k: 10, holdout: true, embed: okEmbed })
    expect(out.every((i) => i.kind === 'chunk')).toBe(true)
    expect(out.length).toBeGreaterThan(0)
    expect(texts.some((t) => t.includes('from "memories"'))).toBe(false)
  })

  it('annotates a chunk highly similar to a more-authoritative memory', async () => {
    const vec = '[1,0,0]'
    const { sql } = mockSql({
      knnChunks: [chunkRow({ embedding: vec })],
      ftsMem: [memRow({ embedding: vec })],
    })
    const out = await searchKnowledge(sql, { tenantId: 't1', query: 'x', k: 10, embed: okEmbed })
    const chunk = out.find((i) => i.kind === 'chunk')!
    expect(chunk.annotation).toBeDefined()
    expect(chunk.annotation).toContain('Use Postgres for the ledger')
  })

  it('binds the tenant + emits the scope cascade (org literal + the scoped pair) in every lane', async () => {
    const { sql, query } = mockSql({ knnChunks: [chunkRow()], knnMem: [memRow()], ftsChunks: [chunkRow()], ftsMem: [memRow()] })
    await searchKnowledge(sql, {
      tenantId: 't1',
      scope: { workspace: 'w', object: { type: 'work_item', id: 'wi_9', title: 'x' } },
      query: 'x',
      k: 5,
      embed: okEmbed,
    })
    // The scope cascade for a work_item object = [org, (work_item, wi_9)]. Every lane must
    // emit the org literal AND bind the cascaded (scope_type, scope_id) pair as params.
    expect(query.mock.calls.length).toBe(4)
    for (const call of query.mock.calls) {
      const text = call[0] as string
      const params = call[1] as unknown[]
      expect(params).toContain('t1')
      expect(text.includes('tenant_id = $1')).toBe(true)
      expect(text).toMatch(/scope_type = 'org'/)
      expect(text).toMatch(/scope_type = \$\d+ and scope_id = \$\d+/)
      // The cascaded pair is actually bound (a foreign scope is never present).
      expect(params).toContain('work_item')
      expect(params).toContain('wi_9')
    }
  })

  it('appends an id tie-break to EVERY lane ORDER BY so equal distance/rank is deterministic', async () => {
    const { sql, texts } = mockSql({ knnChunks: [chunkRow()], knnMem: [memRow()], ftsChunks: [chunkRow()], ftsMem: [memRow()] })
    await searchKnowledge(sql, { tenantId: 't1', query: 'x', k: 10, embed: okEmbed })
    const orderBys = texts.filter((t) => /order by/i.test(t))
    expect(orderBys.length).toBe(4)
    for (const t of orderBys) {
      // Each ORDER BY ends with the `id asc` tie-break (after distance or ts_rank/recency).
      expect(t).toMatch(/order by[\s\S]*,\s*id asc/i)
    }
  })
})
