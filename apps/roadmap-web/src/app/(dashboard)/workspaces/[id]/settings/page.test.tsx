import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOTFOUND')
  }),
}))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('next/navigation', () => ({ notFound }))

import WorkspaceSettingsPage from './page'

function tableResult(result: unknown) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    single: async () => result,
  }
  return builder
}

function supabaseWith(results: Record<string, unknown>) {
  const from = vi.fn((table: string) => tableResult(results[table]))
  return { from }
}

function render() {
  return WorkspaceSettingsPage({ params: Promise.resolve({ id: 'ws-1' }) })
}

describe('WorkspaceSettingsPage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    notFound.mockClear()
  })

  it('calls notFound when the workspace is missing', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ workspaces: { data: null, error: { message: 'x' } } }),
    )

    await expect(render()).rejects.toThrow('NOTFOUND')
  })

  it('renders with the claims subject as current user id', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        workspaces: { data: { id: 'ws-1', team_id: 't1' }, error: null },
        teams: { data: { name: 'T', plan: 'pro' } },
      }),
    )

    await expect(render()).resolves.toBeTruthy()
    expect(getAuthClaims).toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })

  it('still renders when there are no claims (no auth guard on this page)', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(
      supabaseWith({
        workspaces: { data: { id: 'ws-1', team_id: 't1' }, error: null },
        teams: { data: { name: 'T', plan: 'free' } },
      }),
    )

    await expect(render()).resolves.toBeTruthy()
    expect(notFound).not.toHaveBeenCalled()
  })
})
