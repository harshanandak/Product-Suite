import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/ai/agent-core-adapter', () => ({
  executeTaskPlanWithAgentCore: vi.fn(),
}))
vi.mock('@/lib/ai/agent-loop', () => ({
  createCancelSignal: vi.fn(() => ({ cancelled: false })),
}))

import { POST } from './route'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/ai/agent/plan/approve', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// chat_threads select('metadata').eq('id', threadId).single()
function threadClient(thread: unknown) {
  const single = vi.fn(async () => ({ data: thread, error: thread ? null : { message: 'x' } }))
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single,
    update: vi.fn(() => chain),
  }
  const from = vi.fn(() => chain)
  return { from }
}

describe('POST /api/ai/agent/plan/approve auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(req({ planId: 'p1', mode: 'all', threadId: 't1' }))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(req({ planId: 'p1' }))

    expect(res.status).toBe(400)
  })

  it('returns 400 for a prototype-polluting planId', async () => {
    const res = await POST(req({ planId: '__proto__', mode: 'all', threadId: 't1' }))

    expect(res.status).toBe(400)
  })

  it('returns 404 when the thread does not exist', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(threadClient(null))

    const res = await POST(req({ planId: 'p1', mode: 'all', threadId: 't1' }))

    expect(res.status).toBe(404)
  })
})
