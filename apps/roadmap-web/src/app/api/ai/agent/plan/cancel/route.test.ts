import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
// Avoid loading the sibling approve route (and its heavy tool imports).
vi.mock('../approve/route', () => ({ activePlanSignals: new Map() }))

import { POST } from './route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/ai/agent/plan/cancel', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/ai/agent/plan/cancel auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(req({ planId: 'p1', threadId: 't1' }))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(req({ planId: 'p1' }))

    expect(res.status).toBe(400)
  })

  it('returns 400 for a prototype-polluting planId', async () => {
    const res = await POST(req({ planId: '__proto__', threadId: 't1' }))

    expect(res.status).toBe(400)
  })
})
