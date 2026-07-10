import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { PATCH } from './route'

function queryResult(result: unknown) {
  const p = Promise.resolve(result)
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    single: () => Promise.resolve(result),
    then: (onF: unknown, onR: unknown) =>
      p.then(onF as never, onR as never),
  }
  return chain
}

function makeClient(results: unknown[]) {
  let i = 0
  return { from: vi.fn(() => queryResult(results[i++] ?? { data: null })) }
}

const claims = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const ctx = { params: Promise.resolve({ id: 'wi-1' }) }
function req(body: unknown) {
  return new NextRequest('http://localhost/api/work-items/wi-1/dates', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/work-items/[id]/dates auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(null)
    const res = await PATCH(req({}), ctx)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when planned dates are missing', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient([]))
    const res = await PATCH(req({}), ctx)
    expect(res.status).toBe(400)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(
      makeClient([
        { data: { workspace_id: 'ws-1', workspaces: { team_id: 'team-1' } } },
        { data: null },
      ])
    )
    const res = await PATCH(
      req({
        planned_start_date: '2024-01-01',
        planned_end_date: '2024-02-01',
      }),
      ctx
    )
    expect(res.status).toBe(403)
  })
})
