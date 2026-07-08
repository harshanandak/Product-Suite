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

import CanvasListPage from './page'

function supabaseWith({
  workspace,
  workspaceError = null,
  teamMember,
  canvases = [],
  canvasError = null,
}: {
  workspace: unknown
  workspaceError?: unknown
  teamMember: unknown
  canvases?: unknown[]
  canvasError?: unknown
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
    // blocksuite_documents
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ order: async () => ({ data: canvases, error: canvasError }) }),
        }),
      }),
    }
  })
  return { from }
}

const params = Promise.resolve({ id: 'ws-1' })

describe('CanvasListPage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(
      supabaseWith({ workspace: null, teamMember: null }),
    )

    await expect(CanvasListPage({ params })).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('redirects to /dashboard when the workspace is not found', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ workspace: null, workspaceError: { message: 'nope' }, teamMember: null }),
    )

    await expect(CanvasListPage({ params })).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('redirects to /dashboard when the user is not a team member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ workspace: { team_id: 't1' }, teamMember: null }),
    )

    await expect(CanvasListPage({ params })).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('renders (no redirect) when claims + membership resolve, scoped by claims subject', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        workspace: { team_id: 't1' },
        teamMember: { role: 'member' },
        canvases: [],
      }),
    )

    await expect(CanvasListPage({ params })).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
