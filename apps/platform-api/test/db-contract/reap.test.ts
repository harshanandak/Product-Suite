import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isEphemeralTestBranchName, reapStaleBranches } from './neon-branch'

/**
 * Unit coverage for the reap-before-run safety predicate (`reapStaleBranches`),
 * driven entirely off a mocked `fetch` — no Neon creds, no real branches — so it
 * runs in the default `vitest run` alongside the mock suites.
 *
 * These are the regression tests the review asked for: only genuinely-ephemeral,
 * aged-out test branches are ever deleted, the reaper follows Neon's list
 * pagination, and every durable branch (configured parent, default/primary,
 * protected, human-named same-prefix, or one missing the `expires_at` ownership
 * marker) is spared.
 */

const PROJECT = 'proj_test'
const PARENT = 'br-parent-durable'

/** A minimal `Response` shaped just enough for the harness's `neonFetch`. */
function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('isEphemeralTestBranchName', () => {
  it('matches only the exact `db-contract-<epoch>-<8hex>` shape createEphemeralBranch mints', () => {
    expect(isEphemeralTestBranchName('db-contract-1700000000000-abcdef01')).toBe(true)
    // Prefix-only / human-named durable branch — NOT a match.
    expect(isEphemeralTestBranchName('db-contract-base')).toBe(false)
    expect(isEphemeralTestBranchName('db-contract')).toBe(false)
    // Wrong suffix length / non-hex — NOT a match.
    expect(isEphemeralTestBranchName('db-contract-1700000000000-abcdefff01')).toBe(false)
    expect(isEphemeralTestBranchName('db-contract-1700000000000-zzzzzzzz')).toBe(false)
    // Unrelated branches — NOT a match.
    expect(isEphemeralTestBranchName('main')).toBe(false)
    expect(isEphemeralTestBranchName(undefined)).toBe(false)
  })
})

describe('reapStaleBranches safety predicate', () => {
  const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 60 min old → stale
  const YOUNG = new Date(Date.now() - 60 * 1000).toISOString() // 1 min old → not stale
  const EXPIRES = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  let deleteCalls: string[]
  // Capture the ORIGINAL env so we restore (not wipe) it — if this file runs before
  // the real-Neon db-contract tests in the same process, unconditionally deleting
  // these would strip their creds. `undefined` means "was absent" → delete on restore.
  const NEON_KEYS = ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_PARENT_BRANCH_ID'] as const
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of NEON_KEYS) originalEnv[k] = process.env[k]
    process.env.NEON_API_KEY = 'test-key'
    process.env.NEON_PROJECT_ID = PROJECT
    process.env.NEON_PARENT_BRANCH_ID = PARENT
    deleteCalls = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // Restore each var to its captured value; delete only those originally absent.
    for (const k of NEON_KEYS) {
      const prior = originalEnv[k]
      if (prior === undefined) delete process.env[k]
      else process.env[k] = prior
    }
  })

  it('reaps only aged-out ephemeral branches (across pages) and spares every durable branch', async () => {
    // Page 1: a reapable branch + three that must be spared despite matching the
    // ephemeral name AND carrying expires_at (parent id / default / protected).
    const page1 = [
      { id: 'br-stale-1', name: 'db-contract-1700000000000-aaaaaaaa', created_at: OLD, expires_at: EXPIRES },
      { id: PARENT, name: 'db-contract-1700000000001-bbbbbbbb', created_at: OLD, expires_at: EXPIRES },
      { id: 'br-default', name: 'db-contract-1700000000002-cccccccc', created_at: OLD, expires_at: EXPIRES, default: true },
      { id: 'br-protected', name: 'db-contract-1700000000003-dddddddd', created_at: OLD, expires_at: EXPIRES, protected: true },
    ]
    // Page 2 (only reachable if pagination is followed): a second reapable branch +
    // three more spare cases (human-named same-prefix, missing expires_at marker,
    // too-young) + an unrelated durable `main`.
    const page2 = [
      { id: 'br-base', name: 'db-contract-base', created_at: OLD, expires_at: EXPIRES },
      { id: 'br-no-marker', name: 'db-contract-1700000000004-eeeeeeee', created_at: OLD },
      { id: 'br-young', name: 'db-contract-1700000000005-ffffffff', created_at: YOUNG, expires_at: EXPIRES },
      { id: 'br-stale-2', name: 'db-contract-1700000000006-12345678', created_at: OLD, expires_at: EXPIRES },
      { id: 'br-main', name: 'main', created_at: OLD, default: true },
    ]

    const fetchMock = vi.fn(async (input: string | URL, init?: { method?: string }) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      if (method === 'DELETE') {
        deleteCalls.push(url.pathname.split('/').pop() as string)
        return jsonRes({})
      }
      // Neon returns the next-page cursor as `pagination.next` and takes it back as
      // the `cursor` request param. A regression to reading `pagination.cursor`
      // would stop after page 1 and leave `br-stale-2` (page 2) unreaped, failing
      // the assertions below.
      const cursor = url.searchParams.get('cursor')
      if (!cursor) return jsonRes({ branches: page1, pagination: { next: 'page2' } })
      if (cursor === 'page2') return jsonRes({ branches: page2 })
      return jsonRes({ branches: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await reapStaleBranches()

    // Exactly the two aged-out ephemeral branches — one per page — were deleted.
    expect(deleteCalls.sort()).toEqual(['br-stale-1', 'br-stale-2'])
    expect([...result.deleted].sort()).toEqual(['br-stale-1', 'br-stale-2'])
    expect(result.failed).toEqual([])
    // Every branch across BOTH pages was scanned (proves pagination was followed).
    expect(result.scanned).toBe(page1.length + page2.length)

    // Durable branches are never touched — the catastrophic cases especially.
    for (const spared of [PARENT, 'br-default', 'br-protected', 'br-base', 'br-no-marker', 'br-young', 'br-main']) {
      expect(deleteCalls).not.toContain(spared)
    }
  })

  it('never deletes the configured parent branch even when it is old and matches the ephemeral name', async () => {
    const branches = [
      { id: PARENT, name: 'db-contract-1700000000000-aaaaaaaa', created_at: OLD, expires_at: EXPIRES },
    ]
    const fetchMock = vi.fn(async (input: string | URL, init?: { method?: string }) => {
      const url = new URL(String(input))
      if ((init?.method ?? 'GET') === 'DELETE') {
        deleteCalls.push(url.pathname.split('/').pop() as string)
        return jsonRes({})
      }
      return jsonRes({ branches })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await reapStaleBranches()

    expect(deleteCalls).toEqual([])
    expect(result.deleted).toEqual([])
  })

  it('does not delete a stale same-prefix branch that lacks the expires_at marker', async () => {
    const branches = [
      // Exact ephemeral name + old, but NO expires_at → not ours, spare it.
      { id: 'br-orphan', name: 'db-contract-1700000000000-abcdef01', created_at: OLD },
    ]
    const fetchMock = vi.fn(async (input: string | URL, init?: { method?: string }) => {
      const url = new URL(String(input))
      if ((init?.method ?? 'GET') === 'DELETE') {
        deleteCalls.push(url.pathname.split('/').pop() as string)
        return jsonRes({})
      }
      return jsonRes({ branches })
    })
    vi.stubGlobal('fetch', fetchMock)

    await reapStaleBranches()

    expect(deleteCalls).toEqual([])
  })
})
