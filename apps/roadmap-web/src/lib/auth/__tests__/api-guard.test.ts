import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))

import { requireAuth, requireTeamMembership } from '../api-guard'

const CLAIMS = { subject: 'user-1', email: 'u@example.com', provider: 'neon' }

function membershipClient(membership: { id: string } | null) {
  const single = vi.fn(async () => ({ data: membership }))
  const eqUser = vi.fn(() => ({ single }))
  const eqTeam = vi.fn(() => ({ eq: eqUser }))
  const select = vi.fn(() => ({ eq: eqTeam }))
  const from = vi.fn(() => ({ select }))
  const client = { from } as unknown as Parameters<typeof requireTeamMembership>[0]
  return { client, eqUser }
}

describe('requireAuth', () => {
  beforeEach(() => getAuthClaims.mockReset())

  it('returns the claims when authenticated', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    await expect(requireAuth()).resolves.toEqual(CLAIMS)
  })

  it('returns a 401 response when unauthenticated', async () => {
    getAuthClaims.mockResolvedValue(null)
    const res = await requireAuth()
    expect(res).toBeInstanceOf(NextResponse)
    expect((res as NextResponse).status).toBe(401)
  })
})

describe('requireTeamMembership', () => {
  beforeEach(() => getAuthClaims.mockReset())

  it('returns claims + membership for a member, scoped by the claims subject', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqUser } = membershipClient({ id: 'm1' })

    const guard = await requireTeamMembership(client, 'team-1')

    expect(guard).toEqual({
      claims: expect.objectContaining({ subject: 'user-1' }),
      membership: { id: 'm1' },
    })
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns a 401 response when unauthenticated', async () => {
    getAuthClaims.mockResolvedValue(null)
    const { client } = membershipClient(null)

    const res = await requireTeamMembership(client, 'team-1')
    expect((res as NextResponse).status).toBe(401)
  })

  it('returns a 403 response when the user is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client } = membershipClient(null)

    const res = await requireTeamMembership(client, 'team-1')
    expect((res as NextResponse).status).toBe(403)
  })
})
