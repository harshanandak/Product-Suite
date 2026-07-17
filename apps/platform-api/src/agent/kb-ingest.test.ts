import type { Sql } from '@product-suite/db'
import { describe, expect, it, vi } from 'vitest'

import { ingestKnowledge } from './kb-ingest'

type Handler = (text: string, params: unknown[]) => unknown[]

/** A mock `Sql` whose `query` dispatches on the SQL text a handler recognizes. */
function mockSql(handler: Handler) {
  const query = vi.fn(async (text: string, params: unknown[]) => handler(text, params))
  const sql = { query } as unknown as Sql
  return { sql, query }
}

/** An injected embed that echoes one deterministic vector per input text. */
function fakeEmbed() {
  return vi.fn(async (texts: string[]) => ({
    vectors: texts.map((_, i) => [i + 0.5, 0, 0]),
    model: 'openai/text-embedding-3-large',
    dims: 1024,
  }))
}

const isMemSelect = (t: string) => /select .* from memories/is.test(t)
const isMemUpdate = (t: string) => /update memories/i.test(t)
const isItemSelect = (t: string) => /from work_items/i.test(t)
const isChunkInsert = (t: string) => /insert into knowledge_chunks/i.test(t)

describe('ingestKnowledge — memory backfill', () => {
  it('embeds only null-embedding active memories and stamps embed_model', async () => {
    const { sql, query } = mockSql((text) => {
      if (isMemSelect(text)) return [{ id: 'm1', title: 'Use Postgres', body: 'We chose PG' }]
      return []
    })
    const embed = fakeEmbed()

    const res = await ingestKnowledge(sql, { tenantId: 't1', embed })

    expect(res.memoriesEmbedded).toBe(1)
    // The selection only pulls active rows lacking an embedding.
    const sel = query.mock.calls.find(([t]) => isMemSelect(String(t)))!
    expect(String(sel[0])).toMatch(/embedding is null/)
    expect(String(sel[0])).toMatch(/status = 'active'/)
    expect(sel[1]).toEqual(['t1'])
    // The update casts a vector literal to halfvec and stamps embed_model.
    const upd = query.mock.calls.find(([t]) => isMemUpdate(String(t)))!
    expect(String(upd[0])).toMatch(/embedding = \$1::halfvec/)
    expect(String(upd[0])).toMatch(/embed_model = \$2/)
    const params = upd[1] as unknown[]
    expect(params[0]).toBe('[0.5,0,0]') // vector literal
    expect(params[1]).toBe('openai/text-embedding-3-large') // embed_model
    expect(params[2]).toBe('m1')
  })

  it('skips the embed call entirely when no memory needs backfilling', async () => {
    const { sql } = mockSql(() => [])
    const embed = fakeEmbed()
    const res = await ingestKnowledge(sql, { tenantId: 't1', embed })
    expect(res.memoriesEmbedded).toBe(0)
    expect(embed).not.toHaveBeenCalled()
  })
})

describe('ingestKnowledge — work-item chunks', () => {
  it('selects completed, non-archived items joined on statuses.category', async () => {
    const { sql, query } = mockSql((text) => {
      if (isItemSelect(text)) return []
      return []
    })
    await ingestKnowledge(sql, { tenantId: 't1', embed: fakeEmbed() })

    const sel = query.mock.calls.find(([t]) => isItemSelect(String(t)))!
    const text = String(sel[0])
    expect(text).toMatch(/join statuses/i)
    expect(text).toMatch(/category = 'completed'/)
    expect(text).toMatch(/archived = false/)
    expect(sel[1]).toEqual(['t1'])
  })

  it('writes one project-scoped chunk per item with event_time, tier 3 and provenance', async () => {
    const { sql, query } = mockSql((text) => {
      if (isItemSelect(text)) {
        return [
          {
            id: 'w1',
            title: 'Fix login',
            description: 'Cookie bug',
            project_id: 'p1',
            updated_at: '2026-02-02T00:00:00.000Z',
            event_time: '2026-05-01T00:00:00.000Z',
          },
          {
            id: 'w2',
            title: 'Orphan task',
            description: 'No project',
            project_id: null,
            updated_at: '2026-03-03T00:00:00.000Z',
            event_time: null,
          },
        ]
      }
      if (isChunkInsert(text)) return [{ id: 'c-new' }]
      return []
    })

    const res = await ingestKnowledge(sql, { tenantId: 't1', embed: fakeEmbed() })
    expect(res.chunksIngested).toBe(2)

    const inserts = query.mock.calls.filter(([t]) => isChunkInsert(String(t)))
    expect(inserts).toHaveLength(2)

    // Provenance + dedup clause on the insert text.
    const insertText = String(inserts[0]![0])
    expect(insertText).toMatch(/embed_provider/)
    expect(insertText).toMatch(/'openrouter'/)
    expect(insertText).toMatch(/\$5::halfvec/)
    expect(insertText).toMatch(/on conflict .*do nothing/is)

    // Item 1: project-scoped, event_time from latest activity, tier 3, content = title\ndescription.
    const p1 = inserts[0]![1] as unknown[]
    expect(p1[0]).toBe('t1') // tenant_id
    expect(p1[1]).toBe('w1') // source_ref
    expect(p1[2]).toBe('Fix login\nCookie bug') // content
    expect(p1[5]).toBe(3) // tier
    expect(p1[6]).toBe('project') // scope_type
    expect(p1[7]).toBe('p1') // scope_id
    expect(p1[8]).toBe('2026-05-01T00:00:00.000Z') // event_time from activity
    expect(p1[9]).toBe('openai/text-embedding-3-large') // embed_model
    expect(p1[10]).toBe(1024) // embed_dims

    // Item 2: org-scoped (no project), event_time falls back to updated_at.
    const p2 = inserts[1]![1] as unknown[]
    expect(p2[6]).toBe('org')
    expect(p2[7]).toBeNull()
    expect(p2[8]).toBe('2026-03-03T00:00:00.000Z') // fallback to updated_at
  })

  it('is a no-op on re-ingest: a dedup conflict returns no row so nothing is counted', async () => {
    const { sql } = mockSql((text) => {
      if (isItemSelect(text)) {
        return [
          {
            id: 'w1',
            title: 'A',
            description: 'B',
            project_id: 'p1',
            updated_at: '2026-02-02T00:00:00.000Z',
            event_time: '2026-05-01T00:00:00.000Z',
          },
        ]
      }
      // `on conflict do nothing` returns zero rows for an already-ingested item.
      if (isChunkInsert(text)) return []
      return []
    })

    const res = await ingestKnowledge(sql, { tenantId: 't1', embed: fakeEmbed() })
    expect(res.chunksIngested).toBe(0)
  })
})
