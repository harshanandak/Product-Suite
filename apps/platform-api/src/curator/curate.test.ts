import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { CURATOR_MAX_PROBES, curateProposal, type CuratableProposal } from './curate'

/**
 * The curator orchestrator: proposal → candidate → probes through `searchMemories` →
 * verdict. Advisory only; it is never on the write path, so it CANNOT auto-decide.
 *
 * The sharpest correctness constraint is that the curator must never name a private
 * memory belonging to someone other than the reviewer reading the Inbox. That boundary
 * lives in SQL (#151's dual-lane, fail-closed `searchMemories`), so at this tier the
 * thing to prove is that the curator only ever ASKS through those lanes — every query it
 * issues carries a visibility predicate, and the private one is bound to the reviewer.
 * A curator that grew a second, unfiltered path would show up here as a query with no
 * visibility predicate. What Postgres then DOES with those lanes is proven for real in
 * `test/db-contract/memory-curator.test.ts`.
 */
function mockSql(dispatch: (text: string, params: unknown[]) => unknown[] = () => []) {
  const query = vi.fn(async (text: string, params: unknown[]) => dispatch(text, params))
  const sql = { query } as unknown as Sql
  return { sql, query }
}

function proposal(over: Partial<CuratableProposal> = {}): CuratableProposal {
  return {
    target_type: 'memory',
    target_id: null,
    operation: 'create',
    payload: {
      kind: 'fact',
      title: 'Pricing pages ship through the growth review',
      body: 'The growth lead signs off before a pricing page goes live.',
    },
    edited_payload: null,
    ...over,
  }
}

/** A row shaped exactly as `searchMemories` returns one. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'm_existing',
    kind: 'fact',
    title: 'Pricing pages ship through the growth review',
    body: 'The growth lead signs off before any pricing page goes live.',
    status: 'active',
    topics: [],
    root_id: 'm_existing',
    scope_type: 'org',
    scope_id: null,
    ...over,
  }
}

const isPrivateLane = (text: string) => /visibility = 'private'/.test(text)

describe('curateProposal — relation verdicts name the colliding memory', () => {
  it('reports a duplicate and names the memory it duplicates', async () => {
    const { sql } = mockSql((text) => (isPrivateLane(text) ? [] : [row()]))
    const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })

    expect(verdict.outcome).toBe('duplicate')
    expect(verdict.collisions).toHaveLength(1)
    expect(verdict.collisions[0]).toMatchObject({
      relation: 'duplicate',
      memory_id: 'm_existing',
      title: 'Pricing pages ship through the growth review',
      visibility: 'org',
    })
    expect(verdict.summary).toContain('Pricing pages ship through the growth review')
  })

  it('reports an overlap and names the memory it overlaps', async () => {
    const { sql } = mockSql((text) =>
      isPrivateLane(text)
        ? []
        : [
            row({
              id: 'm_overlap',
              body: 'The growth lead reviews the quarterly pricing experiment backlog and the roadmap.',
            }),
          ],
    )
    const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })

    expect(verdict.outcome).toBe('overlap')
    expect(verdict.collisions[0]!.memory_id).toBe('m_overlap')
    expect(verdict.summary).toContain('m_overlap')
  })

  it('reports a conflict and names the memory it contradicts', async () => {
    const { sql } = mockSql((text) =>
      isPrivateLane(text)
        ? []
        : [row({ id: 'm_friday', title: 'Friday releases are not allowed', body: 'Teams must never release on Friday.' })],
    )
    const verdict = await curateProposal(
      sql,
      proposal({
        payload: {
          kind: 'rule',
          title: 'Friday releases are allowed with a sign-off',
          body: 'Teams may release on Friday when the on-call engineer signs off.',
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )

    expect(verdict.outcome).toBe('conflict')
    expect(verdict.collisions[0]).toMatchObject({ relation: 'conflict', memory_id: 'm_friday' })
    expect(verdict.summary).toContain('Friday releases are not allowed')
  })

  it('ranks a conflict ahead of a duplicate, whatever order they came back in', async () => {
    // The duplicate is returned FIRST, so only the ranking can put the contradiction at
    // the top — which is where a reviewer's eye goes.
    const { sql } = mockSql((text) =>
      isPrivateLane(text)
        ? []
        : [
            row({
              id: 'm_dup',
              title: 'Friday releases are allowed with a sign-off',
              body: 'Teams may release on Friday when the on-call engineer signs off.',
            }),
            row({
              id: 'm_conflict',
              title: 'Friday releases are not allowed',
              body: 'Teams must never release on Friday.',
            }),
          ],
    )
    const verdict = await curateProposal(
      sql,
      proposal({
        payload: {
          kind: 'rule',
          title: 'Friday releases are allowed with a sign-off',
          body: 'Teams may release on Friday when the on-call engineer signs off.',
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )

    expect(verdict.outcome).toBe('conflict')
    expect(verdict.collisions.map((c) => [c.memory_id, c.relation])).toEqual([
      ['m_conflict', 'conflict'],
      ['m_dup', 'duplicate'],
    ])
  })
})

describe('curateProposal — a well-formed novel memory', () => {
  it('is clean: no quality findings, no collisions, and a summary that says so', async () => {
    const { sql } = mockSql(() => [])
    const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })

    expect(verdict.outcome).toBe('clean')
    expect(verdict.quality).toEqual([])
    expect(verdict.collisions).toEqual([])
    expect(verdict.summary.length).toBeGreaterThan(10)
  })

  it('reports quality_only when the candidate is malformed but collides with nothing', async () => {
    const { sql } = mockSql(() => [])
    const verdict = await curateProposal(
      sql,
      proposal({ payload: { kind: 'rule', title: 'Note', body: 'Prefer the shared logger.' } }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )

    expect(verdict.outcome).toBe('quality_only')
    expect(verdict.quality.map((f) => f.code)).toEqual(['title_placeholder', 'applicability_missing'])
  })

  it('always carries quality findings alongside a relation verdict', async () => {
    const { sql } = mockSql((text) =>
      isPrivateLane(text) ? [] : [row({ body: 'The growth lead approves a pricing page.' })],
    )
    const verdict = await curateProposal(
      sql,
      proposal({
        payload: {
          kind: 'rule',
          title: 'Pricing pages ship through the growth review',
          body: 'The growth lead approves a pricing page.',
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )
    expect(verdict.outcome).toBe('duplicate')
    expect(verdict.quality.map((f) => f.code)).toContain('applicability_missing')
  })
})

describe('curateProposal — the ownership boundary (leak through the curator)', () => {
  it('reads memories ONLY through lanes that carry a visibility predicate', async () => {
    // "All the paths the curator can reach memories by" — if a future change adds a
    // direct read (to resolve a title, a scope, a chain), it lands here as a query
    // against `memories` with no visibility predicate, and this fails.
    const { sql, query } = mockSql(() => [row()])
    await curateProposal(sql, proposal({ operation: 'supersede', target_id: 'm_target' }), {
      tenantId: 't_1',
      reviewerUserId: 'u_rev',
    })

    expect(query.mock.calls.length).toBeGreaterThan(0)
    for (const [text] of query.mock.calls) {
      expect(String(text)).toMatch(/from "memories"/)
      expect(String(text)).toMatch(/visibility = '(?:org|private)'/)
    }
  })

  it('binds the private lane to the REVIEWER, never to anyone else', async () => {
    const { sql, query } = mockSql(() => [])
    await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_reviewer' })

    const privateCalls = query.mock.calls.filter(([text]) => isPrivateLane(String(text)))
    expect(privateCalls.length).toBeGreaterThan(0)
    for (const [text, params] of privateCalls) {
      expect(String(text)).toMatch(/owner_user_id = \$\d+/)
      expect(params).toContain('u_reviewer')
    }
  })

  it('issues NO private query at all when the reviewer is unknown, and says so', async () => {
    for (const unknown of [undefined, null, '', '   ']) {
      const { sql, query } = mockSql(() => [])
      const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: unknown })

      expect(query.mock.calls.some(([text]) => isPrivateLane(String(text)))).toBe(false)
      expect(query.mock.calls.some(([text]) => /owner_user_id/.test(String(text)))).toBe(false)
      expect(verdict.private_lane_skipped).toBe(true)
    }
  })

  it('does not claim the private lane was skipped when the reviewer is known', async () => {
    const { sql } = mockSql(() => [])
    const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })
    expect(verdict.private_lane_skipped).toBe(false)
  })

  it('names a private collider as private, so it never reads as org policy', async () => {
    // The reviewer's OWN private note is legitimately theirs to see; the panel must
    // label it so a personal note is never mistaken for the organization's position.
    const { sql } = mockSql((text) => (isPrivateLane(text) ? [row({ id: 'm_mine' })] : []))
    const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })

    expect(verdict.collisions[0]).toMatchObject({ memory_id: 'm_mine', visibility: 'private' })
  })

  it('scopes every query to the tenant', async () => {
    const { sql, query } = mockSql(() => [])
    await curateProposal(sql, proposal(), { tenantId: 't_only', reviewerUserId: 'u_rev' })

    expect(query.mock.calls.length).toBeGreaterThan(0)
    for (const [text, params] of query.mock.calls) {
      expect(String(text)).toMatch(/tenant_id = \$1/)
      expect(params[0]).toBe('t_only')
    }
  })
})

describe('curateProposal — what it declines to curate', () => {
  it('is not_applicable for a non-memory proposal, and reads nothing', async () => {
    const { sql, query } = mockSql(() => [])
    const verdict = await curateProposal(sql, proposal({ target_type: 'work_item' }), {
      tenantId: 't_1',
      reviewerUserId: 'u_rev',
    })

    expect(verdict.outcome).toBe('not_applicable')
    expect(query).not.toHaveBeenCalled()
  })

  it('is not_applicable for retract and defer, which carry no candidate text', async () => {
    for (const operation of ['retract', 'defer']) {
      const { sql, query } = mockSql(() => [])
      const verdict = await curateProposal(
        sql,
        proposal({ operation, target_id: 'm_t', payload: { waiting_on: 'legal' } }),
        { tenantId: 't_1', reviewerUserId: 'u_rev' },
      )
      expect(verdict.outcome).toBe('not_applicable')
      expect(verdict.summary).toMatch(/retract|defer|nothing/i)
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('is not_applicable when the payload has no usable title to probe with', async () => {
    const { sql, query } = mockSql(() => [])
    const verdict = await curateProposal(sql, proposal({ payload: { kind: 'fact' } }), {
      tenantId: 't_1',
      reviewerUserId: 'u_rev',
    })
    expect(verdict.outcome).toBe('not_applicable')
    expect(query).not.toHaveBeenCalled()
  })
})

describe('curateProposal — supersede', () => {
  it('never reports the memory being superseded as a collision with itself', async () => {
    // Without this, every supersede verdict would read "duplicates <the row you are
    // replacing>" — a false positive on half of all memory proposals.
    const { sql } = mockSql((text) => (isPrivateLane(text) ? [] : [row({ id: 'm_target' })]))
    const verdict = await curateProposal(
      sql,
      proposal({
        operation: 'supersede',
        target_id: 'm_target',
        payload: {
          title: 'Pricing pages ship through the growth review',
          body: 'The growth lead signs off before a pricing page goes live.',
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )

    expect(verdict.collisions).toEqual([])
    expect(verdict.outcome).toBe('clean')
  })

  it('still reports a DIFFERENT memory as a collision on a supersede', async () => {
    const { sql } = mockSql((text) => (isPrivateLane(text) ? [] : [row({ id: 'm_other' })]))
    const verdict = await curateProposal(
      sql,
      proposal({
        operation: 'supersede',
        target_id: 'm_target',
        payload: {
          title: 'Pricing pages ship through the growth review',
          body: 'The growth lead signs off before a pricing page goes live.',
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )
    expect(verdict.collisions.map((c) => c.memory_id)).toEqual(['m_other'])
  })
})

describe('curateProposal — bounded and deduplicated', () => {
  it('issues at most CURATOR_MAX_PROBES probes even with many topics', async () => {
    const { sql, query } = mockSql(() => [])
    await curateProposal(
      sql,
      proposal({
        payload: {
          kind: 'fact',
          title: 'Pricing pages ship through the growth review',
          body: 'x',
          topics: ['pricing', 'growth', 'releases', 'billing', 'support'],
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )

    // Two lanes per probe (org + private) once the reviewer is known.
    const probes = new Set(query.mock.calls.map(([, params]) => String(params[1])))
    expect(probes.size).toBeLessThanOrEqual(CURATOR_MAX_PROBES)
  })

  it('probes with the title’s content words, not the whole title', async () => {
    const { sql, query } = mockSql(() => [])
    await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })

    const probe = String(query.mock.calls[0]![1][1])
    // `plainto_tsquery` ANDs its terms, so a long probe finds nothing: it is capped and
    // stopword-stripped rather than being the raw title.
    expect(probe.split(/\s+/).length).toBeLessThanOrEqual(4)
    expect(probe).not.toContain('through')
    for (const word of probe.split(/\s+/)) {
      expect('pricing pages ship through the growth review'.toLowerCase()).toContain(word)
    }
  })

  it('counts the other collisions in plain English', async () => {
    const { sql } = mockSql((text) =>
      isPrivateLane(text)
        ? []
        : [row({ id: 'm_a' }), row({ id: 'm_b' }), row({ id: 'm_c' })],
    )
    const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })

    expect(verdict.collisions).toHaveLength(3)
    expect(verdict.summary).toContain('2 other related memories')
  })

  it('says “memory”, singular, when there is exactly one other', async () => {
    const { sql } = mockSql((text) =>
      isPrivateLane(text) ? [] : [row({ id: 'm_a' }), row({ id: 'm_b' })],
    )
    const verdict = await curateProposal(sql, proposal(), { tenantId: 't_1', reviewerUserId: 'u_rev' })
    expect(verdict.summary).toContain('1 other related memory')
    expect(verdict.summary).not.toContain('memories')
  })

  it('reports each colliding memory once, however many probes found it', async () => {
    const { sql } = mockSql((text) => (isPrivateLane(text) ? [] : [row()]))
    const verdict = await curateProposal(
      sql,
      proposal({
        payload: {
          kind: 'fact',
          title: 'Pricing pages ship through the growth review',
          body: 'The growth lead signs off before a pricing page goes live.',
          topics: ['pricing', 'growth'],
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )
    expect(verdict.collisions.map((c) => c.memory_id)).toEqual(['m_existing'])
  })
})

describe('curateProposal — advisory', () => {
  it('marks every verdict advisory, including the worst one', async () => {
    const { sql } = mockSql((text) =>
      isPrivateLane(text)
        ? []
        : [row({ id: 'm_friday', title: 'Friday releases are not allowed', body: 'Teams must never release on Friday.' })],
    )
    const bad = await curateProposal(
      sql,
      proposal({
        payload: {
          kind: 'rule',
          title: 'Friday releases are allowed with a sign-off',
          body: 'Teams may release on Friday when the on-call engineer signs off.',
        },
      }),
      { tenantId: 't_1', reviewerUserId: 'u_rev' },
    )
    expect(bad.advisory).toBe(true)

    const { sql: cleanSql } = mockSql(() => [])
    expect((await curateProposal(cleanSql, proposal(), { tenantId: 't_1' })).advisory).toBe(true)
  })
})
