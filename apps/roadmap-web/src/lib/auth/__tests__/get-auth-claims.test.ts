import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
}))

const { readCanonicalAuthClaimsFromCookieStore } = vi.hoisted(() => ({
  readCanonicalAuthClaimsFromCookieStore: vi.fn(),
}))

const { getUser, getSession, mapSupabaseUserToAuthClaims } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  mapSupabaseUserToAuthClaims: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}))

vi.mock('@/lib/canonical-auth', () => ({
  readCanonicalAuthClaimsFromCookieStore,
}))

vi.mock('@/lib/auth-contracts', () => ({
  mapSupabaseUserToAuthClaims,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser, getSession } })),
}))

import { getAuthClaims } from '@/lib/auth/get-auth-claims'

describe('getAuthClaims', () => {
  beforeEach(() => {
    readCanonicalAuthClaimsFromCookieStore.mockReset()
    getUser.mockReset()
    getSession.mockReset()
    mapSupabaseUserToAuthClaims.mockReset()
    cookieStore.get.mockReset()
  })

  it('returns canonical claims when the cookie is valid, without touching Supabase', async () => {
    const claims = { subject: 'user-1', email: 'user@example.com', provider: 'neon' }
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({ ok: true, claims })

    await expect(getAuthClaims()).resolves.toEqual(claims)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('reads canonical claims from the request cookie store', async () => {
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({
      ok: true,
      claims: { subject: 'x' },
    })

    await getAuthClaims()

    expect(readCanonicalAuthClaimsFromCookieStore).toHaveBeenCalledWith(cookieStore)
  })

  it('falls back to the live Supabase session when the canonical cookie is missing', async () => {
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({
      ok: false,
      error: { code: 'CANONICAL_AUTH_SESSION_MISSING', missing: ['session'] },
    })
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mapSupabaseUserToAuthClaims.mockReturnValue({
      ok: true,
      claims: { subject: 'user-1', email: 'u@example.com', provider: 'supabase' },
    })
    getSession.mockResolvedValue({ data: { session: { expires_at: 1893456000 } } })

    await expect(getAuthClaims()).resolves.toEqual({
      subject: 'user-1',
      email: 'u@example.com',
      provider: 'supabase',
      expires_at: 1893456000,
    })
  })

  it('returns null when neither canonical claims nor a Supabase session exist', async () => {
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({
      ok: false,
      error: { code: 'CANONICAL_AUTH_SESSION_INVALID', missing: ['expires_at'] },
    })
    getUser.mockResolvedValue({ data: { user: null } })

    await expect(getAuthClaims()).resolves.toBeNull()
    expect(mapSupabaseUserToAuthClaims).not.toHaveBeenCalled()
  })

  it('returns null when the Supabase user cannot be mapped to claims', async () => {
    readCanonicalAuthClaimsFromCookieStore.mockResolvedValue({
      ok: false,
      error: { code: 'CANONICAL_AUTH_SESSION_MISSING', missing: ['session'] },
    })
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mapSupabaseUserToAuthClaims.mockReturnValue({ ok: false, error: { missing: ['email'] } })

    await expect(getAuthClaims()).resolves.toBeNull()
  })
})
