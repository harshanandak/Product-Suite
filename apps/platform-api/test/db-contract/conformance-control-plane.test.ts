import { describe, expect, it } from 'vitest'

import { controlPlaneFetchForTest } from './harness'

describe('Neon control-plane failure classification', () => {
  it.each([
    [401, 'AUTH_FAILED'],
    [403, 'AUTH_FAILED'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [500, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
    [400, 'REQUEST_FAILED'],
  ] as const)('maps HTTP %s to %s without leaking response details', async (status, code) => {
    await expect(controlPlaneFetchForTest(
      'opaque-token',
      '/projects/secret-project',
      { method: 'POST', body: { secret: 'request-body' } },
      async () => new Response(JSON.stringify({ secret: 'response-body' }), { status }),
      [],
    )).rejects.toMatchObject({ code, message: code, diagnostic: { endpointCategory: 'project', statusClass: `${Math.floor(status / 100)}xx` } })
  })

  it('maps transport failures to NETWORK_FAILED without leaking the thrown detail', async () => {
    await expect(controlPlaneFetchForTest(
      'opaque-token',
      '/projects/secret-project',
      { method: 'POST' },
      async () => { throw new TypeError('https://secret.example/token=opaque-token') },
      [],
    )).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
      message: 'NETWORK_FAILED',
      diagnostic: { endpointCategory: 'project', statusClass: 'network' },
    })
  })
})
