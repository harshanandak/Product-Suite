import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { Sql } from '@product-suite/db'

import { curateProposal } from '../../src/curator/curate'

import { hasNeonCreds, query, type Seed } from './harness'
import { withTransactionalDb } from './suite-resource'

/**
 * Real-DB contract for the CURATOR PASS (research rec #3, memory-curator).
 *
 * The mocked suite proves the curator only ever ASKS through the dual-lane,
 * fail-closed `searchMemories` — every query it issues carries a visibility
 * predicate, and the private one binds the reviewer. That is a statement about the
 * SQL we send. It cannot establish what Postgres then DOES with it.
 *
 * This file establishes the part no mock can: with Alice's real private memory
 * sitting in a real table, a real verdict computed for Bob NAMES NOTHING OF HERS —
 * not in a collision, not in the summary text — while Alice's own verdict does name
 * it (so the check cannot pass by finding nothing at all). This is the
 * leak-through-the-curator case: the curator prints titles, so anything it can reach
 * that the retrieval lanes correctly hide would be disclosed in plain text.
 *
 * Skipped without NEON_API_KEY/NEON_PROJECT_ID so the default `vitest run` stays
 * green; the `db-contract` CI job supplies the secrets. These assertions therefore
 * only ever execute in CI.
 */
const DB_CONTRACT_TIMEOUT_MS = 180_000

type TransactionalRunner = <T>(body: (context: { sql: Sql; seed: Seed }) => Promise<T>) => Promise<T>

const ALICE = 'u_alice_owner'
const BOB = 'u_bob_nonowner'

/** The text both tiers share, so FTS reaches them from the same candidate probe. */
const SHARED = 'zephyrpolicy deployment approval'

/** Insert one memory directly (the domain create path has no visibility support yet). */
async function insertMemory(
  sql: Sql,
  tenantId: string,
  over: {
    kind?: 'decision' | 'fact' | 'rule'
    title: string
    body?: string
    visibility?: 'private' | 'org'
    ownerUserId?: string | null
  },
): Promise<string> {
  const id = randomUUID()
  await query(
    sql,
    `insert into memories ("id", "tenant_id", "kind", "title", "body", "root_id", "owner_user_id", "visibility")
     values ($1, $2, $3, $4, $5, $1, $6, $7)`,
    [
      id,
      tenantId,
      over.kind ?? 'fact',
      over.title,
      over.body ?? '',
      over.ownerUserId ?? null,
      over.visibility ?? 'org',
    ],
  )
  return id
}

/** A `memory:create` proposal whose candidate text matches the seeded memories. */
const CANDIDATE = {
  target_type: 'memory',
  target_id: null,
  operation: 'create',
  payload: {
    kind: 'fact',
    title: `${SHARED} needs two reviewers`,
    body: `A ${SHARED} needs two reviewers before it ships.`,
  },
  edited_payload: null,
}

describe.skipIf(!hasNeonCreds())(
  'db-contract: curator pass over real rows (real Neon branch)',
  { timeout: DB_CONTRACT_TIMEOUT_MS },
  () => {
    const runTransactionalDb = withTransactionalDb('memory-curator') as unknown as TransactionalRunner

    it('never names another user’s private memory as a collision — and DOES name the org one', async () => {
      await runTransactionalDb(async ({ sql, seed }) => {
        const t = seed.tenantId
        const orgId = await insertMemory(sql, t, {
          title: `${SHARED} needs two reviewers`,
          body: `A ${SHARED} needs two reviewers before it ships.`,
        })
        const aliceNote = await insertMemory(sql, t, {
          title: `${SHARED} alicesecret needs two reviewers`,
          body: `A ${SHARED} needs two reviewers before it ships.`,
          visibility: 'private',
          ownerUserId: ALICE,
        })

        // --- Bob: a real, authenticated NON-owner reviewing the proposal ---
        const bob = await curateProposal(sql, CANDIDATE, { tenantId: t, reviewerUserId: BOB })
        const bobNamed = bob.collisions.map((c) => c.memory_id)
        expect(bobNamed).not.toContain(aliceNote)
        // The title is what would leak, so assert the TEXT too, not just the id: the
        // summary is a rendered sentence that could carry a title the list does not.
        expect(JSON.stringify(bob)).not.toContain('alicesecret')
        expect(JSON.stringify(bob)).not.toContain(aliceNote)
        // Non-vacuous in the other direction: the org memory IS found, so this cannot
        // pass by the curator failing to collide with anything at all.
        expect(bobNamed).toContain(orgId)
        expect(bob.outcome).toBe('duplicate')
        expect(bob.private_lane_skipped).toBe(false)

        // --- Alice: the owner. Her own note is legitimately hers to see. ---
        const alice = await curateProposal(sql, CANDIDATE, { tenantId: t, reviewerUserId: ALICE })
        const aliceNamed = alice.collisions.map((c) => c.memory_id)
        expect(aliceNamed).toContain(aliceNote)
        expect(aliceNamed).toContain(orgId)
        // And it is labelled as the personal tier, so the panel can never present a
        // private note as the organization's position.
        expect(alice.collisions.find((c) => c.memory_id === aliceNote)?.visibility).toBe('private')
        expect(alice.collisions.find((c) => c.memory_id === orgId)?.visibility).toBe('org')

        // --- An unresolvable reviewer: org only, never unfiltered ---
        const anon = await curateProposal(sql, CANDIDATE, { tenantId: t, reviewerUserId: null })
        expect(anon.collisions.map((c) => c.memory_id)).toEqual([orgId])
        expect(JSON.stringify(anon)).not.toContain('alicesecret')
        expect(anon.private_lane_skipped).toBe(true)
        expect(anon.collisions.every((c) => c.visibility === 'org')).toBe(true)
      })
    })

    it('never names a memory from ANOTHER tenant, however well it matches', async () => {
      await runTransactionalDb(async ({ sql, seed }) => {
        const t = seed.tenantId
        const foreignTenant = randomUUID()
        const mine = await insertMemory(sql, t, {
          title: `${SHARED} needs two reviewers`,
          body: `A ${SHARED} needs two reviewers before it ships.`,
        })
        // A perfect textual match in a tenant the reviewer has nothing to do with.
        await query(sql, `insert into tenants (id, slug, name) values ($1, $2, $3)`, [
          foreignTenant,
          `contract-${foreignTenant}`,
          'Foreign Org',
        ])
        const foreign = await insertMemory(sql, foreignTenant, {
          title: `${SHARED} needs two reviewers`,
          body: `A ${SHARED} needs two reviewers before it ships.`,
        })

        const verdict = await curateProposal(sql, CANDIDATE, { tenantId: t, reviewerUserId: BOB })
        expect(verdict.collisions.map((c) => c.memory_id)).toEqual([mine])
        expect(JSON.stringify(verdict)).not.toContain(foreign)
      })
    })

    it('reports a real contradiction against a real row (the verdict earns its keep)', async () => {
      await runTransactionalDb(async ({ sql, seed }) => {
        const t = seed.tenantId
        const existing = await insertMemory(sql, t, {
          kind: 'rule',
          title: 'zephyrpolicy friday releases are not allowed',
          body: 'Teams must never release on Friday.',
        })

        const verdict = await curateProposal(
          sql,
          {
            target_type: 'memory',
            target_id: null,
            operation: 'create',
            payload: {
              kind: 'rule',
              title: 'zephyrpolicy friday releases are allowed with a sign-off',
              body: 'Teams may release on Friday when the on-call engineer signs off.',
            },
            edited_payload: null,
          },
          { tenantId: t, reviewerUserId: BOB },
        )

        expect(verdict.outcome).toBe('conflict')
        expect(verdict.collisions[0]).toMatchObject({ memory_id: existing, relation: 'conflict' })
        // The reviewer is told WHICH memory, in words — that is the whole product.
        expect(verdict.summary).toContain('zephyrpolicy friday releases are not allowed')
      })
    })
  },
)
