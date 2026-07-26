import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import { retrieveForContext, retrieveRulesForContext, searchMemories } from './memory-retrieval'

/**
 * The two guarantees the dual-tier design says must be in CI from day one
 * (docs/research/2026-07-25-personal-vs-org-memory.md, "the cheapest v1 slice"):
 *
 *   (a) a NON-OWNER's retrieval returns ZERO private rows, on every retrieval path;
 *   (b) memory retrieval surfaces nothing a permission-scoped list query wouldn't.
 *
 * Asserting these against a mock that returns a canned list would prove nothing — it
 * would pass even if a query dropped its visibility predicate entirely. So the fake
 * below behaves like the DATABASE instead: it holds one corpus and APPLIES whatever
 * visibility predicate the SQL actually asks for. A code path that forgets to
 * constrain visibility therefore gets the whole corpus back and the test fails, which
 * is precisely the fail-open regression these invariants exist to catch.
 *
 * This suite verifies the predicates the application SENDS, and runs everywhere.
 * The database's own behaviour — the biconditional CHECK, the `'org'` default, the
 * index, and these same invariants against real rows — is exercised for real in
 * test/db-contract/memory-tier.test.ts, which only runs in CI (it needs an ephemeral
 * Neon branch). Keep both: this one fails fast on every push, that one proves
 * Postgres agrees.
 */

interface Row {
  id: string
  kind: string
  title: string
  body: string
  scope_type: string
  visibility: 'private' | 'org'
  owner_user_id: string | null
  // Rule-lane columns (harmless on non-rule rows).
  attrs: null
  pinned: boolean
  status: string
  topics: string[]
  root_id: string
}

function row(over: Partial<Row> & Pick<Row, 'id'>): Row {
  return {
    kind: 'fact',
    title: over.id,
    body: '',
    scope_type: 'org',
    visibility: 'org',
    owner_user_id: null,
    attrs: null,
    pinned: false,
    status: 'active',
    topics: [],
    root_id: over.id,
    ...over,
  }
}

/** Alice owns two private memories (one of them a rule); the rest is org-wide. */
const CORPUS: Row[] = [
  row({ id: 'org_decision', kind: 'decision' }),
  row({ id: 'org_rule', kind: 'rule' }),
  row({ id: 'alice_private_note', visibility: 'private', owner_user_id: 'u_alice' }),
  row({ id: 'alice_private_rule', kind: 'rule', visibility: 'private', owner_user_id: 'u_alice' }),
  row({ id: 'bob_private_note', visibility: 'private', owner_user_id: 'u_bob' }),
]

/**
 * A fake that enforces the SQL it is given, the way Postgres would: it resolves the
 * `visibility` / `owner_user_id` predicate (with `$n` params bound), plus `kind` and
 * `status`. Anything the query did not constrain is simply not filtered.
 */
function dbLikeSql() {
  const query = vi.fn(async (text: string, params: unknown[]) => {
    const bind = (marker: string): unknown => {
      const m = new RegExp(`${marker} = \\$(\\d+)`).exec(text)
      return m ? params[Number(m[1]) - 1] : undefined
    }
    let rows = CORPUS
    if (/status = 'active'/.test(text)) rows = rows.filter((r) => r.status === 'active')
    if (/kind = 'rule'/.test(text)) rows = rows.filter((r) => r.kind === 'rule')
    if (/visibility = 'org'/.test(text)) {
      rows = rows.filter((r) => r.visibility === 'org')
    } else if (/visibility = 'private'/.test(text)) {
      rows = rows.filter((r) => r.visibility === 'private')
      const owner = bind('owner_user_id')
      // An unbound owner filter is exactly the fail-open bug: leave it unfiltered so
      // the invariant assertions below catch it rather than silently pass.
      if (owner !== undefined) rows = rows.filter((r) => r.owner_user_id === owner)
    }
    return rows
  })
  return { sql: { query } as unknown as Sql, query }
}

/** Every memory id reachable by `asker` across ALL THREE retrieval paths. */
async function everythingReachableBy(asker?: string | null): Promise<Set<string>> {
  const { sql } = dbLikeSql()
  const seen = new Set<string>()
  const mem = await retrieveForContext(sql, { tenantId: 't_1', askerUserId: asker })
  for (const m of mem.injected) seen.add(m.memoryId)
  const rules = await retrieveRulesForContext(sql, { tenantId: 't_1', askerUserId: asker })
  for (const m of rules.injected) seen.add(m.memoryId)
  const hits = await searchMemories(sql, 't_1', 'anything', 25, asker)
  for (const h of hits) seen.add(h.id)
  // The rendered text matters as much as the ids: a memory that never got an
  // attribution row but DID reach the prompt is the worst version of this bug.
  const rendered = [mem.fenced, mem.privateFenced, rules.fenced, rules.privateFenced].join('\n')
  for (const r of CORPUS) if (rendered.includes(r.title)) seen.add(r.id)
  return seen
}

/** What a permission-scoped list query would return: org rows + the asker's own. */
function permittedFor(asker?: string | null): Set<string> {
  return new Set(
    CORPUS.filter((r) => r.visibility === 'org' || (asker ? r.owner_user_id === asker : false)).map((r) => r.id),
  )
}

describe('INVARIANT (a) — a non-owner retrieves ZERO private rows, on every path', () => {
  it("Bob never reaches Alice's private memory or her private rule", async () => {
    const reachable = await everythingReachableBy('u_bob')
    expect(reachable.has('alice_private_note')).toBe(false)
    expect(reachable.has('alice_private_rule')).toBe(false)
    // Bob does reach his OWN private row and the org rows — the lane works, it is
    // just scoped. (Otherwise this test would pass with retrieval switched off.)
    expect(reachable.has('bob_private_note')).toBe(true)
    expect(reachable.has('org_decision')).toBe(true)
    expect(reachable.has('org_rule')).toBe(true)
  })

  it("Alice reaches her own private rows and never Bob's", async () => {
    const reachable = await everythingReachableBy('u_alice')
    expect(reachable.has('alice_private_note')).toBe(true)
    expect(reachable.has('alice_private_rule')).toBe(true)
    expect(reachable.has('bob_private_note')).toBe(false)
  })

  it('an UNKNOWN asker reaches no private row at all (fail closed, not unfiltered)', async () => {
    for (const asker of [undefined, null, '', '   ']) {
      const reachable = await everythingReachableBy(asker)
      expect([...reachable].sort()).toEqual(['org_decision', 'org_rule'])
    }
  })

  it('each path is independently scoped — no single path leaks a foreign private row', async () => {
    const { sql } = dbLikeSql()
    const mem = await retrieveForContext(sql, { tenantId: 't_1', askerUserId: 'u_bob' })
    expect(mem.injected.map((m) => m.memoryId)).not.toContain('alice_private_note')
    expect(mem.privateFenced).not.toContain('alice_private_note')

    const rules = await retrieveRulesForContext(sql, { tenantId: 't_1', askerUserId: 'u_bob' })
    expect(rules.injected.map((m) => m.memoryId)).not.toContain('alice_private_rule')
    expect(rules.privateFenced).not.toContain('alice_private_rule')
    // And a private rule never appears in the fence the model reads as team policy.
    expect(rules.fenced).not.toContain('alice_private_rule')
    expect(rules.fenced).not.toContain('bob_private_note')

    const hits = await searchMemories(sql, 't_1', 'anything', 25, 'u_bob')
    expect(hits.map((h) => h.id)).not.toContain('alice_private_note')
  })
})

describe('INVARIANT (b) — retrieval surfaces nothing a permission-scoped list would not', () => {
  it('holds for an owner, a non-owner, and an unknown asker', async () => {
    for (const asker of ['u_alice', 'u_bob', undefined]) {
      const reachable = await everythingReachableBy(asker)
      const permitted = permittedFor(asker)
      const excess = [...reachable].filter((id) => !permitted.has(id))
      expect(excess).toEqual([])
    }
  })

  it('every injected row is labelled with the tier that entitled it (attribution is honest)', async () => {
    const { sql } = dbLikeSql()
    const mem = await retrieveForContext(sql, { tenantId: 't_1', askerUserId: 'u_alice' })
    const rules = await retrieveRulesForContext(sql, { tenantId: 't_1', askerUserId: 'u_alice' })
    const byId = new Map(
      [...mem.injected, ...rules.injected].map((m) => [m.memoryId, m] as const),
    )
    for (const r of CORPUS) {
      const injected = byId.get(r.id)
      if (!injected) continue
      expect(injected.visibility).toBe(r.visibility)
      // owner_matched must never be claimed for a row with no owner.
      expect(injected.ownerMatched).toBe(r.owner_user_id === 'u_alice')
    }
    // Sanity: the loop above actually examined both tiers.
    expect([...byId.values()].some((m) => m.visibility === 'private')).toBe(true)
    expect([...byId.values()].some((m) => m.visibility === 'org')).toBe(true)
  })

  it('the private lane never widens the org lane — org results are identical with and without an asker', async () => {
    const { sql: a } = dbLikeSql()
    const { sql: b } = dbLikeSql()
    const without = await retrieveForContext(a, { tenantId: 't_1' })
    const with_ = await retrieveForContext(b, { tenantId: 't_1', askerUserId: 'u_alice' })
    expect(with_.fenced).toBe(without.fenced)
    const orgOf = (r: { injected: { memoryId: string; visibility: string }[] }) =>
      r.injected.filter((m) => m.visibility === 'org').map((m) => m.memoryId)
    expect(orgOf(with_)).toEqual(orgOf(without))
  })
})
