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

import SettingsLayout from './layout'

// Chainable builder: select/eq/single resolve to the configured result.
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
  return SettingsLayout({
    children: null,
    params: Promise.resolve({ id: 'ws-1' }),
  })
}

describe('SettingsLayout auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
    notFound.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(supabaseWith({}))

    await expect(render()).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('calls notFound when the workspace is missing', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ workspaces: { data: null, error: { message: 'x' } } }),
    )

    await expect(render()).rejects.toThrow('NOTFOUND')
  })

  it('redirects to /dashboard when the user is not a team member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        workspaces: { data: { name: 'W', team_id: 't1' }, error: null },
        team_members: { data: null },
      }),
    )

    await expect(render()).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('redirects to the workspace when the member lacks admin/owner role', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        workspaces: { data: { name: 'W', team_id: 't1' }, error: null },
        team_members: { data: { role: 'member' } },
      }),
    )

    await expect(render()).rejects.toThrow('REDIRECT:/workspaces/ws-1')
  })

  it('renders for an admin member, scoping the membership lookup by claims subject', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        workspaces: { data: { name: 'W', team_id: 't1' }, error: null },
        team_members: { data: { role: 'admin' } },
      }),
    )

    await expect(render()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})
