import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { redirect, notFound } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOTFOUND')
  }),
}))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('next/navigation', () => ({ redirect, notFound }))

import TeamSettingsPage from './page'

const params = Promise.resolve({ id: 't1' })

function supabaseWith({
  team = { id: 't1', name: 'Team', plan: 'free' } as Record<string, unknown> | null,
  teamError = null as unknown,
  membership = { role: 'owner' } as Record<string, unknown> | null,
  members = [] as unknown[],
  invitations = [] as unknown[],
  workspaceCount = 0,
}) {
  const from = vi.fn((table: string) => {
    if (table === 'teams') {
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: team, error: teamError }) }),
        }),
      }
    }
    if (table === 'team_members') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ single: async () => ({ data: membership }) }),
            order: async () => ({ data: members }),
          }),
        }),
      }
    }
    if (table === 'invitations') {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({ gt: () => ({ order: async () => ({ data: invitations }) }) }),
          }),
        }),
      }
    }
    // workspaces (count query)
    return { select: () => ({ eq: async () => ({ count: workspaceCount }) }) }
  })
  return { from }
}

describe('TeamSettingsPage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
    notFound.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(supabaseWith({}))

    await expect(TeamSettingsPage({ params })).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('calls notFound when the team does not exist', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(supabaseWith({ team: null, teamError: { message: 'nope' } }))

    await expect(TeamSettingsPage({ params })).rejects.toThrow('NOTFOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('redirects to /dashboard when the claims subject is not a member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(supabaseWith({ membership: null }))

    await expect(TeamSettingsPage({ params })).rejects.toThrow('REDIRECT:/dashboard')
    expect(redirect).toHaveBeenCalledWith('/dashboard')
  })

  it('renders for a member without redirecting', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ members: [{ id: 'm1', role: 'owner', user_id: 'user-1', users: null }] }),
    )

    const result = await TeamSettingsPage({ params })
    expect(result).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})
