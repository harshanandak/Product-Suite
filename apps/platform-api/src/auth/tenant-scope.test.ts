import { describe, expect, it, vi } from 'vitest'

import { callerTenantIds, callerUserId } from './tenant-scope'
import type { AuthClaims } from '@product-suite/contracts'

const claims = { provider: 'clerk', subject: 'user_clerk_1' } as AuthClaims

describe('callerTenantIds', () => {
  it('returns the active-membership tenant ids, scoped by the caller subject', async () => {
    const sql = vi.fn(async () => [{ tenant_id: 't_1' }, { tenant_id: 't_2' }])
    const ids = await callerTenantIds(sql as never, claims)
    expect(ids).toEqual(['t_1', 't_2'])
    // Scoped by the caller's Clerk subject.
    expect(sql.mock.calls[0]?.slice(1) ?? []).toContain('user_clerk_1')
  })

  it('returns [] when the caller is in no active org (callers must deny)', async () => {
    const sql = vi.fn(async () => [])
    expect(await callerTenantIds(sql as never, claims)).toEqual([])
  })
})

describe('callerUserId', () => {
  it('resolves the internal users.id for the caller’s Clerk subject', async () => {
    const sql = vi.fn(async () => [{ user_id: 'u_1' }])
    const id = await callerUserId(sql as never, claims)
    expect(id).toBe('u_1')
    // Scoped by the verified Clerk subject — the human actor_id for provenance.
    expect(sql.mock.calls[0]?.slice(1) ?? []).toContain('user_clerk_1')
  })

  it('returns null when the subject maps to no internal user (unprovisioned identity)', async () => {
    const sql = vi.fn(async () => [])
    expect(await callerUserId(sql as never, claims)).toBeNull()
  })
})
