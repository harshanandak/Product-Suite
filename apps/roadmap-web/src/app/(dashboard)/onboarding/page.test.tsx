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
vi.mock('@/components/onboarding/onboarding-flow', () => ({
  OnboardingFlow: () => null,
}))

import OnboardingPage from './page'

function supabaseWith({ teams }: { teams: Array<{ team_id: string }> }) {
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ limit: async () => ({ data: teams }) }) }),
  }))
  return { from }
}

describe('OnboardingPage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    redirect.mockClear()
  })

  it('redirects to /login when there are no canonical claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(supabaseWith({ teams: [] }))

    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/login')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('redirects to /dashboard when the authenticated user already has a team', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(supabaseWith({ teams: [{ team_id: 't1' }] }))

    await expect(OnboardingPage()).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('renders the onboarding flow (no redirect) when the user has no team', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(supabaseWith({ teams: [] }))

    await expect(OnboardingPage()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
