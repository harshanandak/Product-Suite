import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST } from './route'

describe('POST /api/admin/setup-users-table auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 403 in production without checking auth or running DDL', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const res = await POST()
      expect(res.status).toBe(403)
      expect(getAuthClaims).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    const rpc = vi.fn()
    createClient.mockResolvedValue({ rpc })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST()

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('runs the setup SQL when authenticated', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }))
    createClient.mockResolvedValue({ rpc })
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })

    const res = await POST()

    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('exec_sql', expect.objectContaining({ sql: expect.any(String) }))
  })
})
