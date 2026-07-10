import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
}))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/components/user/user-profile-form', () => ({
  UserProfileForm: () => null,
}))
vi.mock('@/components/ui/card', () => ({
  Card: () => null,
  CardContent: () => null,
  CardDescription: () => null,
  CardHeader: () => null,
  CardTitle: () => null,
}))

import ProfilePage from './page'

function supabaseWith({
  userProfile,
  profileError,
  teamMemberships,
}: {
  userProfile: unknown
  profileError?: unknown
  teamMemberships: unknown[]
}) {
  const from = vi.fn((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: userProfile, error: profileError ?? null }) }),
        }),
      }
    }
    return {
      select: () => ({
        eq: () => ({ order: async () => ({ data: teamMemberships }) }),
      }),
    }
  })
  return { from }
}

describe('ProfilePage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(
      supabaseWith({ userProfile: null, teamMemberships: [] }),
    )

    await expect(ProfilePage()).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('renders (no redirect) for an authenticated user, scoping queries by claims.subject', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    const supabase = supabaseWith({
      userProfile: {
        name: 'Ada',
        avatar_url: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-02-01T00:00:00Z',
      },
      teamMemberships: [
        { id: 'm1', role: 'owner', joined_at: '2024-01-02T00:00:00Z', teams: { id: 't1', name: 'Acme' } },
      ],
    })
    createClient.mockResolvedValue(supabase)

    await expect(ProfilePage()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    expect(supabase.from).toHaveBeenCalledWith('users')
    expect(supabase.from).toHaveBeenCalledWith('team_members')
  })

  it('still renders when the profile row is missing (error path)', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        userProfile: null,
        profileError: { message: 'not found' },
        teamMemberships: [],
      }),
    )

    await expect(ProfilePage()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
