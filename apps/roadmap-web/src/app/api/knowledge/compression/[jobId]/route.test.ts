import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { getJobStatus, cancelJob } = vi.hoisted(() => ({
  getJobStatus: vi.fn(),
  cancelJob: vi.fn(),
}))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/ai/compression', () => ({ getJobStatus, cancelJob }))

import { GET, DELETE } from './route'

const URL = 'http://localhost/api/knowledge/compression/job-1'

function ctx(jobId = 'job-1') {
  return { params: Promise.resolve({ jobId }) }
}

function teamClient(membership: { team_id: string } | null) {
  const single = vi.fn(async () => ({ data: membership }))
  const eqTeam = vi.fn(() => ({ single }))
  const eqUser = vi.fn(() => ({ eq: eqTeam }))
  const select = vi.fn(() => ({ eq: eqUser }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, eqUser }
}

const claims = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

describe('GET/DELETE /api/knowledge/compression/[jobId] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    getJobStatus.mockReset()
    cancelJob.mockReset()
  })

  it('GET returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest(URL), ctx())

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('GET returns 404 when the job does not exist', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue({ from: vi.fn() })
    getJobStatus.mockResolvedValue(null)

    const res = await GET(new NextRequest(URL), ctx())

    expect(res.status).toBe(404)
  })

  it('GET returns 403 when the claims subject is not on the job team', async () => {
    getAuthClaims.mockResolvedValue(claims)
    getJobStatus.mockResolvedValue({ id: 'job-1', teamId: 'team-1' })
    const { client, eqUser } = teamClient(null)
    createClient.mockResolvedValue(client)

    const res = await GET(new NextRequest(URL), ctx())

    expect(res.status).toBe(403)
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('DELETE returns 400 when the job cannot be cancelled', async () => {
    getAuthClaims.mockResolvedValue(claims)
    getJobStatus.mockResolvedValue({ id: 'job-1', teamId: 'team-1' })
    const { client } = teamClient({ team_id: 'team-1' })
    createClient.mockResolvedValue(client)
    cancelJob.mockResolvedValue(false)

    const res = await DELETE(new NextRequest(URL, { method: 'DELETE' }), ctx())

    expect(res.status).toBe(400)
  })
})
