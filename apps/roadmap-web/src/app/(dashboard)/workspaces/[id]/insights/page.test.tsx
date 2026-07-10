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
vi.mock('@/components/insights/insights-dashboard', () => ({
  InsightsDashboard: () => null,
}))

import InsightsPage from './page'

function supabaseWith({
  workspace,
  workspaceError = null,
  membership,
}: {
  workspace: unknown
  workspaceError?: unknown
  membership: unknown
}) {
  const from = vi.fn((table: string) => {
    if (table === 'workspaces') {
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: workspace, error: workspaceError }) }),
        }),
      }
    }
    // team_members
    return {
      select: () => ({
        eq: () => ({ eq: () => ({ single: async () => ({ data: membership }) }) }),
      }),
    }
  })
  return { from }
}

const params = Promise.resolve({ id: 'ws-1' })
const searchParams = Promise.resolve({ tab: undefined })

describe('InsightsPage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(
      supabaseWith({ workspace: null, membership: null }),
    )

    await expect(InsightsPage({ params, searchParams })).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('redirects to /workspaces when the workspace is not found', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ workspace: null, workspaceError: { message: 'nope' }, membership: null }),
    )

    await expect(InsightsPage({ params, searchParams })).rejects.toThrow('REDIRECT:/workspaces')
  })

  it('redirects to /workspaces when the user has no membership', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ workspace: { id: 'ws-1', name: 'WS', team_id: 't1' }, membership: null }),
    )

    await expect(InsightsPage({ params, searchParams })).rejects.toThrow('REDIRECT:/workspaces')
  })

  it('renders the dashboard (no redirect) when claims + membership resolve', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        workspace: { id: 'ws-1', name: 'WS', team_id: 't1' },
        membership: { id: 'm-1', role: 'member' },
      }),
    )

    await expect(InsightsPage({ params, searchParams })).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
