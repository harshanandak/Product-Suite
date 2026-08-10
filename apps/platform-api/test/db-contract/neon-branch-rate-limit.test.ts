import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createEphemeralBranch,
  deleteEphemeralBranchStrict,
  preflightBranchCapacity,
  suiteBranchPrefix,
} from './neon-branch'

const originalEnv = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  process.env = { ...originalEnv }
})

function response(status: number, body: unknown = {}, retryAfter = '0'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'Retry-After': retryAfter }),
    json: async () => body,
  } as Response
}

function configure(): void {
  process.env.NEON_API_KEY = 'unit-key'
  process.env.NEON_PROJECT_ID = 'unit-project'
  process.env.DB_CONTRACT_RUN_TOKEN = 'unit-run'
  process.env.DB_CONTRACT_BRANCH_CAP = '10'
}

describe('Neon branch control-plane rate handling', () => {
  it('retries bounded safe GET and DELETE calls for 423, 429, and 503', async () => {
    configure()
    const statuses = [429, 202, 423, 503, 404]
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => response(statuses.shift() ?? 404))
    vi.stubGlobal('fetch', fetchMock)

    await deleteEphemeralBranchStrict('opaque-id', 1_000)

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      'DELETE', 'DELETE', 'GET', 'GET', 'GET',
    ])
  })

  it('stops safe retries at the bounded attempt limit', async () => {
    configure()
    const fetchMock = vi.fn(async () => response(429))
    vi.stubGlobal('fetch', fetchMock)

    await expect(preflightBranchCapacity(2, {
      runToken: 'unit-run',
      branchCap: 10,
      exactHead: 'a'.repeat(40),
      telemetryPath: 'unit-telemetry.json',
    })).rejects.toThrow('DB_CONTRACT_BRANCH_CAPACITY_UNAVAILABLE')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('fails closed when Retry-After exceeds the total retry deadline', async () => {
    configure()
    const fetchMock = vi.fn(async () => response(429, {}, '6'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(preflightBranchCapacity(2, {
      runToken: 'unit-run',
      branchCap: 10,
      exactHead: 'a'.repeat(40),
      telemetryPath: 'unit-telemetry.json',
    })).rejects.toThrow('DB_CONTRACT_BRANCH_CAPACITY_UNAVAILABLE')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('bounds each request timeout by the remaining total retry deadline', async () => {
    configure()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { branches: [{ id: 'existing', name: 'production' }] })))

    await expect(preflightBranchCapacity(2, {
      runToken: 'unit-run',
      branchCap: 10,
      exactHead: 'a'.repeat(40),
      telemetryPath: 'unit-telemetry.json',
    })).resolves.toBeUndefined()
    expect(timeoutSpy).toHaveBeenCalled()
    expect(timeoutSpy.mock.calls.every(([timeoutMs]) => timeoutMs > 0 && timeoutMs <= 5_000)).toBe(true)
  })

  it('never retries POST and reconciles one indeterminate create by exact name', async () => {
    configure()
    let createdName = ''
    let posts = 0
    let lists = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1
        createdName = (JSON.parse(String(init.body)) as { branch: { name: string } }).branch.name
        throw new TypeError('transport detail must stay redacted')
      }
      lists += 1
      return response(200, {
        branches: [{
          id: 'opaque-id',
          name: createdName,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          connection_uris: [{ connection_uri: 'opaque-uri' }],
        }],
      })
    }))

    await expect(createEphemeralBranch(suiteBranchPrefix('rate-limit'))).resolves.toEqual({
      branchId: 'opaque-id',
      connectionUri: 'opaque-uri',
    })
    expect(posts).toBe(1)
    expect(lists).toBe(1)
  })

  it('fails closed when indeterminate-create reconciliation finds duplicates', async () => {
    configure()
    let createdName = ''
    let posts = 0
    let lists = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1
        createdName = (JSON.parse(String(init.body)) as { branch: { name: string } }).branch.name
        throw new TypeError('transport detail must stay redacted')
      }
      lists += 1
      return response(200, {
        branches: [
          { id: 'opaque-a', name: createdName, expires_at: new Date(Date.now() + 60_000).toISOString() },
          { id: 'opaque-b', name: createdName, expires_at: new Date(Date.now() + 60_000).toISOString() },
        ],
      })
    }))

    await expect(createEphemeralBranch(suiteBranchPrefix('rate-limit'))).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_CREATE_RECONCILIATION_AMBIGUOUS',
    })
    expect(posts).toBe(1)
    expect(lists).toBe(1)
  })

  it('fails closed when an exact-name reconciliation duplicate is missing TTL', async () => {
    configure()
    let createdName = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        createdName = (JSON.parse(String(init.body)) as { branch: { name: string } }).branch.name
        throw new TypeError('transport detail must stay redacted')
      }
      return response(200, {
        branches: [
          { id: 'opaque-a', name: createdName },
          { id: 'opaque-b', name: createdName, expires_at: new Date(Date.now() + 60_000).toISOString() },
        ],
      })
    }))

    await expect(createEphemeralBranch(suiteBranchPrefix('rate-limit'))).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_CREATE_RECONCILIATION_AMBIGUOUS',
    })
  })

  it('rejects an exact-name reconciliation branch whose TTL is expired', async () => {
    configure()
    let createdName = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        createdName = (JSON.parse(String(init.body)) as { branch: { name: string } }).branch.name
        throw new TypeError('transport detail must stay redacted')
      }
      return response(200, {
        branches: [{
          id: 'opaque-expired',
          name: createdName,
          expires_at: new Date(Date.now() - 1).toISOString(),
          connection_uris: [{ connection_uri: 'opaque-uri' }],
        }],
      })
    }))

    await expect(createEphemeralBranch(suiteBranchPrefix('rate-limit'))).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_CREATE_INCOMPLETE',
    })
  })

  it('fails closed instead of accepting a partial page before an empty page', async () => {
    configure()
    let createdName = ''
    let page = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        createdName = (JSON.parse(String(init.body)) as { branch: { name: string } }).branch.name
        throw new TypeError('transport detail must stay redacted')
      }
      page += 1
      if (page === 1) {
        return response(200, {
          branches: [{ id: 'opaque-partial', name: createdName, expires_at: new Date(Date.now() + 60_000).toISOString() }],
          pagination: { next: 'cursor-1' },
        })
      }
      return response(200, { branches: [], pagination: { next: 'cursor-2' } })
    }))

    await expect(createEphemeralBranch(suiteBranchPrefix('rate-limit'))).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_LIST_PAGINATION_UNCERTAIN',
    })
  })

  it('fails closed instead of accepting partial results when a cursor repeats', async () => {
    configure()
    let createdName = ''
    let page = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        createdName = (JSON.parse(String(init.body)) as { branch: { name: string } }).branch.name
        throw new TypeError('transport detail must stay redacted')
      }
      page += 1
      if (page === 1) {
        return response(200, {
          branches: [{ id: 'opaque-partial', name: createdName, expires_at: new Date(Date.now() + 60_000).toISOString() }],
          pagination: { next: 'cursor-1' },
        })
      }
      return response(200, {
        branches: [{ id: 'opaque-other', name: 'unrelated' }],
        pagination: { next: 'cursor-1' },
      })
    }))

    await expect(createEphemeralBranch(suiteBranchPrefix('rate-limit'))).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_LIST_PAGINATION_UNCERTAIN',
    })
  })
})
