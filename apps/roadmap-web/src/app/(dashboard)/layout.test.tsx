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
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: () => null,
  SidebarInset: () => null,
}))
vi.mock('@/components/layout/app-sidebar', () => ({ AppSidebar: () => null }))

import DashboardLayout from './layout'

function clientWith({
  profile,
  membership,
}: {
  profile: { name: string } | null
  membership: { team_id: string } | null
}) {
  const from = vi.fn((table: string) => {
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }
    }
    if (table === 'team_members') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: membership }) }) }) }
    }
    return { select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }
  })
  return { from }
}

describe('DashboardLayout auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(clientWith({ profile: null, membership: null }))

    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('renders children without redirecting when the user has no team', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(clientWith({ profile: { name: 'X' }, membership: null }))

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined()
    expect(redirect).not.toHaveBeenCalled()
  })
})
