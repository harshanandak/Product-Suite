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

import DashboardPage from './page'

function supabaseWith({
  teams,
  workspaces,
}: {
  teams: Array<{ team_id: string }>
  workspaces: Array<{ id: string }>
}) {
  const from = vi.fn((table: string) => {
    if (table === 'team_members') {
      return {
        select: () => ({ eq: () => ({ limit: async () => ({ data: teams }) }) }),
      }
    }
    return {
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: workspaces }) }) }),
      }),
    }
  })
  return { from }
}

describe('DashboardPage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(supabaseWith({ teams: [], workspaces: [] }))

    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('redirects to /onboarding when the authenticated user has no teams', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(supabaseWith({ teams: [], workspaces: [] }))

    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/onboarding')
  })

  it('redirects to the most recent workspace, scoped by the claims subject', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ teams: [{ team_id: 't1' }], workspaces: [{ id: 'ws-9' }] }),
    )

    await expect(DashboardPage()).rejects.toThrow('REDIRECT:/workspaces/ws-9')
  })
})
