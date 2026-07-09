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

import AIPage from './page'

const params = Promise.resolve({ id: 'ws-1' })

function supabaseWith({
  workspace = { id: 'ws-1', name: 'WS', team_id: 't1', phase: null } as Record<
    string,
    unknown
  > | null,
  workspaceError = null as unknown,
  teamMember = { role: 'member' } as Record<string, unknown> | null,
  team = { name: 'Team', subscription_plan: 'free' } as Record<string, unknown> | null,
}) {
  const from = vi.fn((table: string) => {
    if (table === 'workspaces') {
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: workspace, error: workspaceError }) }),
        }),
      }
    }
    if (table === 'team_members') {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ single: async () => ({ data: teamMember }) }) }),
        }),
      }
    }
    // teams
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: team }) }) }),
    }
  })
  return { from }
}

describe('AIPage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
    notFound.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(supabaseWith({}))

    await expect(AIPage({ params })).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('calls notFound when the workspace does not exist', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ workspace: null, workspaceError: { message: 'nope' } }),
    )

    await expect(AIPage({ params })).rejects.toThrow('NOTFOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('redirects to /dashboard when the claims subject lacks team access', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(supabaseWith({ teamMember: null }))

    await expect(AIPage({ params })).rejects.toThrow('REDIRECT:/dashboard')
    expect(redirect).toHaveBeenCalledWith('/dashboard')
  })

  it('renders for an authorized member without redirecting', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(supabaseWith({}))

    const result = await AIPage({ params })
    expect(result).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})
