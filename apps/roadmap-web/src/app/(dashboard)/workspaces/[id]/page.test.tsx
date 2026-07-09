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
vi.mock('./_components/workspace-content', () => ({ WorkspaceContent: () => null }))

import WorkspacePage from './page'

function clientWith({
  workspace,
  teamMember,
}: {
  workspace: { id: string; team_id: string } | null
  teamMember: { role: string } | null
}) {
  const from = vi.fn((table: string) => {
    if (table === 'workspaces') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: workspace, error: workspace ? null : new Error('missing') }),
          }),
        }),
      }
    }
    if (table === 'team_members') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: teamMember }) }) }) }) }
    }
    return { select: () => ({ eq: () => ({}) }) }
  })
  return { from }
}

const props = {
  params: Promise.resolve({ id: 'ws-1' }),
  searchParams: Promise.resolve({}),
}

describe('WorkspacePage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
    notFound.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(clientWith({ workspace: null, teamMember: null }))

    await expect(WorkspacePage(props)).rejects.toThrow('REDIRECT:/login')
  })

  it('calls notFound when the workspace does not exist', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(clientWith({ workspace: null, teamMember: null }))

    await expect(WorkspacePage(props)).rejects.toThrow('NOTFOUND')
  })

  it('redirects to /dashboard when the user is not a team member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(clientWith({ workspace: { id: 'ws-1', team_id: 't1' }, teamMember: null }))

    await expect(WorkspacePage(props)).rejects.toThrow('REDIRECT:/dashboard')
  })
})
