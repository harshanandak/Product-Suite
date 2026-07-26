import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { Sql } from '@product-suite/db'

import {
  insertAttributions,
  retrieveForContext,
  retrieveRulesForContext,
  searchMemories,
} from '../../src/agent/memory-retrieval'

import { hasNeonCreds, query, withDbBranch } from './harness'

/**
 * Real-DB contract for the personal-vs-org ownership axis (migration 0016,
 * personal-vs-org-memory-b0d3975f).
 *
 * The mocked suites assert the SQL the application SENDS. This asserts what
 * Postgres actually DOES with it: that the biconditional CHECK rejects both
 * malformed tiers, that `visibility` defaults to 'org' so the migration is a no-op
 * for existing rows, that the retrieval index exists, and — the part no mock can
 * establish — that a real query against real rows returns zero of another user's
 * private memories on every retrieval path.
 *
 * Skipped without NEON_API_KEY/NEON_PROJECT_ID so the default `vitest run` stays
 * green; the `db-contract` CI job supplies the secrets and runs it for real. That
 * means these assertions only ever execute in CI.
 */
const DB_CONTRACT_TIMEOUT_MS = 180_000

const ALICE = 'u_alice_owner'
const BOB = 'u_bob_nonowner'

/** Insert one memory directly (the domain create path has no visibility support yet). */
async function insertMemory(
  sql: Sql,
  tenantId: string,
  over: {
    kind?: 'decision' | 'fact' | 'rule'
    title: string
    visibility?: 'private' | 'org'
    ownerUserId?: string | null
    omitVisibility?: boolean
  },
): Promise<string> {
  const id = randomUUID()
  const cols = ['id', 'tenant_id', 'kind', 'title', 'body', 'root_id', 'owner_user_id']
  const vals: unknown[] = [id, tenantId, over.kind ?? 'fact', over.title, '', id, over.ownerUserId ?? null]
  // Omitting the column entirely is how we prove the DEFAULT, not just that we can
  // write 'org' explicitly.
  if (!over.omitVisibility) {
    cols.push('visibility')
    vals.push(over.visibility ?? 'org')
  }
  await query(
    sql,
    `insert into memories (${cols.map((c) => `"${c}"`).join(', ')})
     values (${vals.map((_, i) => `$${i + 1}`).join(', ')})`,
    vals,
  )
  return id
}

describe.skipIf(!hasNeonCreds())(
  'db-contract: memory ownership axis (real Neon branch)',
  { timeout: DB_CONTRACT_TIMEOUT_MS },
  () => {
    it('the CHECK rejects both malformed tiers and accepts both valid ones', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        // A private memory with NO owner is retrievable by nobody — silently dead.
        await expect(
          insertMemory(sql, seed.tenantId, { title: 'orphan private', visibility: 'private', ownerUserId: null }),
        ).rejects.toThrow(/memories_private_requires_owner/)

        // An org memory WITH an owner is a mislabelled private one — a leak that
        // reads as intentional.
        await expect(
          insertMemory(sql, seed.tenantId, { title: 'owned org', visibility: 'org', ownerUserId: ALICE }),
        ).rejects.toThrow(/memories_private_requires_owner/)

        // Both well-formed combinations persist.
        const orgId = await insertMemory(sql, seed.tenantId, { title: 'org fine' })
        const privId = await insertMemory(sql, seed.tenantId, {
          title: 'private fine',
          visibility: 'private',
          ownerUserId: ALICE,
        })
        const rows = await query<{ id: string; visibility: string; owner_user_id: string | null }>(
          sql,
          `select id, visibility, owner_user_id from memories where id = any($1)`,
          [[orgId, privId]],
        )
        expect(rows).toHaveLength(2)
        expect(rows.find((r) => r.id === orgId)).toMatchObject({ visibility: 'org', owner_user_id: null })
        expect(rows.find((r) => r.id === privId)).toMatchObject({ visibility: 'private', owner_user_id: ALICE })
      })
    })

    it("visibility DEFAULTS to 'org' when the insert omits it (the zero-touch migration guarantee)", async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const id = await insertMemory(sql, seed.tenantId, { title: 'legacy shaped row', omitVisibility: true })
        const rows = await query<{ visibility: string }>(sql, `select visibility from memories where id = $1`, [id])
        expect(rows[0]?.visibility).toBe('org')
      })
    })

    it('the dual-lane retrieval index exists with the expected column order', async () => {
      await withDbBranch(async ({ sql }) => {
        const rows = await query<{ indexdef: string }>(
          sql,
          `select indexdef from pg_indexes
           where tablename = 'memories' and indexname = 'memories_tenant_visibility_scope_idx'`,
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.indexdef).toMatch(
          /\(tenant_id, status, visibility, owner_user_id, scope_type, scope_id\)/,
        )
      })
    })

    it('INVARIANT (a), for real: a non-owner retrieves ZERO private rows on every path', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const t = seed.tenantId
        const orgId = await insertMemory(sql, t, { kind: 'decision', title: 'zephyrpolicy org decision' })
        const orgRuleId = await insertMemory(sql, t, { kind: 'rule', title: 'zephyrpolicy org rule' })
        const aliceNote = await insertMemory(sql, t, {
          title: 'zephyrpolicy alice private note',
          visibility: 'private',
          ownerUserId: ALICE,
        })
        const aliceRule = await insertMemory(sql, t, {
          kind: 'rule',
          title: 'zephyrpolicy alice private rule',
          visibility: 'private',
          ownerUserId: ALICE,
        })

        // --- Bob (a real, authenticated, NON-owner) ---
        const bobMem = await retrieveForContext(sql, { tenantId: t, askerUserId: BOB })
        const bobRules = await retrieveRulesForContext(sql, { tenantId: t, askerUserId: BOB })
        const bobHits = await searchMemories(sql, t, 'zephyrpolicy', 25, BOB)
        const bobReach = new Set([
          ...bobMem.injected.map((m) => m.memoryId),
          ...bobRules.injected.map((m) => m.memoryId),
          ...bobHits.map((h) => h.id),
        ])
        expect(bobReach.has(aliceNote)).toBe(false)
        expect(bobReach.has(aliceRule)).toBe(false)
        // Non-vacuous: the org tier still reaches him, so this cannot pass by
        // retrieving nothing at all.
        expect(bobReach.has(orgId)).toBe(true)
        expect(bobReach.has(orgRuleId)).toBe(true)
        expect(bobMem.privateFenced).toBe('')
        expect(bobRules.privateFenced).toBe('')
        expect(`${bobMem.fenced}${bobRules.fenced}`).not.toContain('alice private')

        // --- Alice (the owner) ---
        const aliceMem = await retrieveForContext(sql, { tenantId: t, askerUserId: ALICE })
        const aliceRules = await retrieveRulesForContext(sql, { tenantId: t, askerUserId: ALICE })
        expect(aliceMem.injected.map((m) => m.memoryId)).toContain(aliceNote)
        expect(aliceRules.injected.map((m) => m.memoryId)).toContain(aliceRule)
        expect(aliceMem.privateFenced).toContain('alice private note')
        // Her private rule is hers, but it is never dressed up as team policy.
        expect(aliceRules.fenced).not.toContain('alice private rule')
        expect(aliceRules.privateFenced).toContain('alice private rule')

        // --- Unknown asker: org only, never unfiltered ---
        const anonMem = await retrieveForContext(sql, { tenantId: t })
        const anonHits = await searchMemories(sql, t, 'zephyrpolicy', 25)
        expect(anonMem.injected.map((m) => m.memoryId)).toEqual([orgId])
        expect(anonHits.map((h) => h.id)).toEqual([orgId])
        expect(anonMem.privateFenced).toBe('')
      })
    })

    it('attribution rows persist the tier for both lanes', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const t = seed.tenantId
        const orgId = await insertMemory(sql, t, { kind: 'decision', title: 'quixotic org decision' })
        await insertMemory(sql, t, {
          title: 'quixotic alice note',
          visibility: 'private',
          ownerUserId: ALICE,
        })

        const mem = await retrieveForContext(sql, { tenantId: t, askerUserId: ALICE })
        expect(mem.injected).toHaveLength(2)
        await insertAttributions(
          sql,
          { runId: seed.runId, tenantId: t, via: 'retrieved' },
          mem.injected.map((m) => ({
            memoryId: m.memoryId,
            rank: m.rank,
            tokens: m.tokens,
            visibility: m.visibility,
            ownerMatched: m.ownerMatched,
          })),
        )

        const rows = await query<{ memory_id: string; visibility: string; owner_matched: boolean }>(
          sql,
          `select memory_id, visibility, owner_matched from run_memory_attributions
           where run_id = $1 order by visibility`,
          [seed.runId],
        )
        expect(rows).toHaveLength(2)
        expect(rows.find((r) => r.memory_id === orgId)).toMatchObject({
          visibility: 'org',
          owner_matched: false,
        })
        const priv = rows.find((r) => r.visibility === 'private')
        expect(priv).toBeDefined()
        expect(priv?.owner_matched).toBe(true)
      })
    })
  },
)
