import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))

import { POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

function req(body: unknown) {
  return new NextRequest('http://localhost/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/ai/chat auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(req({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when messages are missing', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 for an unknown model', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const res = await POST(
      req({ messages: [{ role: 'user', content: 'hi' }], model: '__nope__' })
    )
    expect(res.status).toBe(400)
  })
})
