import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
}))

const { readCanonicalAuthClaimsFromCookieStore } = vi.hoisted(() => ({
  readCanonicalAuthClaimsFromCookieStore: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}))

vi.mock('@/lib/canonical-auth', () => ({
  readCanonicalAuthClaimsFromCookieStore,
}))

import { getAuthClaims } from '@/lib/auth/get-auth-claims'

describe('getAuthClaims', () => {
  beforeEach(() => {
    readCanonicalAuthClaimsFromCookieStore.mockReset()
    cookieStore.get.mockReset()
  })

  it('returns the validated claims for a valid canonical session', async () => {
    const claims = { subject: 'user-1', email: 'user@example.com', provider: 'neon' }
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({ ok: true, claims })

    await expect(getAuthClaims()).resolves.toEqual(claims)
  })

  it('reads canonical claims from the request cookie store', async () => {
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({
      ok: true,
      claims: { subject: 'x' },
    })

    await getAuthClaims()

    expect(readCanonicalAuthClaimsFromCookieStore).toHaveBeenCalledWith(cookieStore)
  })

  it('returns null when there is no valid canonical session', async () => {
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({
      ok: false,
      error: { code: 'CANONICAL_AUTH_SESSION_MISSING', missing: ['session'] },
    })

    await expect(getAuthClaims()).resolves.toBeNull()
  })

  it('returns null when the canonical session is invalid or expired', async () => {
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({
      ok: false,
      error: { code: 'CANONICAL_AUTH_SESSION_INVALID', missing: ['expires_at'] },
    })

    await expect(getAuthClaims()).resolves.toBeNull()
  })
})
