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

import TimelinePage from './page'

// Chainable builder. `.single()` resolves to result; awaiting a non-single
// chain (Promise.all queries) yields the builder whose `.data` is read.
function tableResult(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    single: async () => result,
    data: result?.data,
    error: result?.error,
  }
  return builder
}

function supabaseWith(results: Record<string, { data?: unknown; error?: unknown }>) {
  const from = vi.fn((table: string) => tableResult(results[table] ?? { data: [] }))
  return { from }
}

function render() {
  return TimelinePage({ params: Promise.resolve({ id: 'ws-1' }) })
}

describe('TimelinePage auth', () => {
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

  it('renders the timeline for an authorized member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        workspaces: { data: { id: 'ws-1', name: 'W', team_id: 't1' }, error: null },
        team_members: { data: { role: 'admin' } },
        work_items: { data: [] },
        linked_items: { data: [] },
        departments: { data: [] },
      }),
    )

    await expect(render()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})
