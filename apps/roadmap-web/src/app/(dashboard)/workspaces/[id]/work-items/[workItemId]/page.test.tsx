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

import WorkItemDetailPage from './page'

// Chainable builder. `.single()` resolves to result; awaiting a non-single
// chain (count/list queries) yields the builder, exposing result's own props.
function tableResult(result: Record<string, unknown>) {
  const builder: Record<string, unknown> = {
    ...result,
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    single: async () => result,
  }
  return builder
}

function supabaseWith(results: Record<string, Record<string, unknown>>) {
  const from = vi.fn((table: string) => tableResult(results[table] ?? { data: [], count: 0 }))
  return { from }
}

function render() {
  return WorkItemDetailPage({
    params: Promise.resolve({ id: 'ws-1', workItemId: 'wi-1' }),
  })
}

describe('WorkItemDetailPage auth', () => {
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

  it('calls notFound when the work item is missing', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({ work_items: { data: null, error: { message: 'x' } } }),
    )

    await expect(render()).rejects.toThrow('NOTFOUND')
  })

  it('redirects to /dashboard when the user is not a team member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        work_items: {
          data: { id: 'wi-1', workspace: { id: 'ws-1', team_id: 't1' } },
          error: null,
        },
        team_members: { data: null },
      }),
    )

    await expect(render()).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('renders the detail shell for an authorized member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      supabaseWith({
        work_items: {
          data: {
            id: 'wi-1',
            name: 'Item',
            phase: 'MVP',
            workspace_id: 'ws-1',
            workspace: { id: 'ws-1', name: 'W', team_id: 't1' },
          },
          error: null,
          count: 0,
        },
        team_members: { data: { role: 'member' } },
        timeline_items: { data: [] },
        product_tasks: { count: 0 },
        feedback: { count: 0 },
      }),
    )

    await expect(render()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})
