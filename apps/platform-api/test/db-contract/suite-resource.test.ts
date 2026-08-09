import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  connectPinnedForTest,
  createSuiteResourceLimiter,
  createTransactionalDbSuite,
  SuiteResourceError,
  type TransactionalDbDependencies,
} from './suite-resource'
import { dedicatedCleanupFailure } from './harness'
import { NeonBranchError } from './neon-branch'
import {
  assertCurrentRunBranchesAbsent,
  createEphemeralBranch,
  deleteEphemeralBranchStrict,
  isCurrentRunBranchName,
  preflightBranchCapacity,
  suiteBranchPrefix,
} from './neon-branch'
import { runRequiredSetup } from './reap-setup'

type Hook = () => Promise<void>

const originalEnv = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  process.env = { ...originalEnv }
})

function fixture() {
  const events: string[] = []
  let setup: Hook = async () => undefined
  let teardown: Hook = async () => undefined
  const client = {
    query: vi.fn(async (text: string) => {
      events.push(text)
      return { rows: [] }
    }),
    release: vi.fn(() => { events.push('release') }),
  }
  const seed = { tenantId: 'sentinel' } as never
  const deps: TransactionalDbDependencies = {
    registerBeforeAll: (hook) => { setup = hook },
    registerAfterAll: (hook) => { teardown = hook },
    branchPrefix: vi.fn(() => 'db-contract-unit'),
    createBranch: vi.fn(async () => ({ branchId: 'secret-branch', connectionUri: 'secret-uri' })),
    prepare: vi.fn(async () => { events.push('migrate') }),
    connect: vi.fn(async () => client),
    transactionSql: vi.fn(() => ({}) as never),
    seed: vi.fn(async () => { events.push('seed'); return seed }),
    observeSentinelAbsent: vi.fn(async (_uri, tenantId) => { events.push(`observe:${tenantId}`) }),
    deleteBranch: vi.fn(async () => { events.push('delete-404') }),
    suiteLimiter: { acquire: vi.fn(async () => () => undefined) },
  }
  return { deps, events, client, get setup() { return setup }, get teardown() { return teardown } }
}

describe('transactional suite resource', () => {
  it('never admits more than two active suite resources', async () => {
    const limiter = createSuiteResourceLimiter(2)
    const releases = Array.from({ length: 3 }, () => {
      let resolve!: () => void
      const promise = new Promise<void>((done) => { resolve = done })
      return { promise, resolve }
    })
    let active = 0
    let maximum = 0

    const runs = releases.map(({ promise }, index) => limiter.run(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await promise
      active -= 1
      return index
    }))

    await vi.waitFor(() => expect(active).toBe(2))
    expect(maximum).toBe(2)
    releases[0]?.resolve()
    await vi.waitFor(() => expect(runs[0]).resolves.toBe(0))
    await vi.waitFor(() => expect(active).toBe(2))
    releases[1]?.resolve()
    releases[2]?.resolve()
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2])
    expect(maximum).toBe(2)
  })

  it.each([0, -1, 1.5, 3])('rejects suite concurrency %s outside the exact 1..2 bound', (limit) => {
    expect(() => createSuiteResourceLimiter(limit)).toThrow('DB_CONTRACT_CONCURRENCY_INVALID')
  })

  it('overlaps two suite lifetimes while keeping branch and sentinel identity isolated', async () => {
    const limiter = createSuiteResourceLimiter(2)
    const first = fixture()
    const second = fixture()
    let arrivals = 0
    let releaseCreates!: () => void
    const bothCreating = new Promise<void>((resolve) => { releaseCreates = resolve })
    let activeCreates = 0
    let maximumCreates = 0
    const observed: string[] = []

    const configure = (f: ReturnType<typeof fixture>, suite: string, sentinel: string): void => {
      f.deps.suiteLimiter = limiter
      f.deps.branchPrefix = () => `prefix-${suite}`
      f.deps.createBranch = vi.fn(async (prefix) => {
        activeCreates += 1
        maximumCreates = Math.max(maximumCreates, activeCreates)
        arrivals += 1
        if (arrivals === 2) releaseCreates()
        await bothCreating
        activeCreates -= 1
        return { branchId: `branch-${suite}`, connectionUri: `uri-${prefix}` }
      })
      f.deps.seed = vi.fn(async () => ({ tenantId: sentinel }) as never)
      f.deps.observeSentinelAbsent = vi.fn(async (uri, tenantId) => {
        observed.push(`${uri}:${tenantId}`)
      })
    }

    configure(first, 'accept-path', 'sentinel-a')
    configure(second, 'memory-tier', 'sentinel-b')
    const runFirst = createTransactionalDbSuite('accept-path', first.deps)
    const runSecond = createTransactionalDbSuite('memory-tier', second.deps)

    await Promise.all([first.setup(), second.setup()])
    await Promise.all([
      runFirst(async ({ seed }) => expect(seed.tenantId).toBe('sentinel-a')),
      runSecond(async ({ seed }) => expect(seed.tenantId).toBe('sentinel-b')),
    ])
    await Promise.all([first.teardown(), second.teardown()])

    expect(maximumCreates).toBe(2)
    expect(observed.sort()).toEqual([
      'uri-prefix-accept-path:sentinel-a',
      'uri-prefix-memory-tier:sentinel-b',
    ])
  })

  it('migrates once, seeds every test, rolls back, observes absence, and strictly deletes', async () => {
    const f = fixture()
    const run = createTransactionalDbSuite('memory-tier', f.deps)

    await f.setup()
    await run(async ({ seed }) => { expect(seed.tenantId).toBe('sentinel') })
    await run(async () => undefined)
    await f.teardown()

    expect(f.deps.prepare).toHaveBeenCalledTimes(1)
    expect(f.deps.seed).toHaveBeenCalledTimes(2)
    expect(f.events).toEqual([
      'migrate',
      'BEGIN', 'SAVEPOINT db_contract_test_root', 'seed', 'ROLLBACK', 'observe:sentinel', 'release',
      'BEGIN', 'SAVEPOINT db_contract_test_root', 'seed', 'ROLLBACK', 'observe:sentinel', 'release',
      'delete-404',
    ])
  })

  it('rolls back and proves absence after an assertion failure', async () => {
    const f = fixture()
    const run = createTransactionalDbSuite('accept-path', f.deps)
    await f.setup()

    const assertion = new Error('assertion-detail')
    await expect(run(async () => { throw assertion })).rejects.toBe(assertion)
    expect(f.events).toContain('ROLLBACK')
    expect(f.events).toContain('observe:sentinel')
  })

  it('retains the original failure while redacting cleanup details', async () => {
    const f = fixture()
    const run = createTransactionalDbSuite('accept-path', {
      ...f.deps,
      observeSentinelAbsent: async () => { throw new Error('postgres://user:password@secret') },
    })
    await f.setup()

    const assertion = new Error('assertion-detail')
    const failure = await run(async () => { throw assertion }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors[0]).toBe(assertion)
    expect((failure as AggregateError).errors[1]).toMatchObject({ code: 'DB_CONTRACT_SENTINEL_LEAK_UNPROVEN' })
    expect(String(failure)).not.toContain('postgres://')
    expect(String(failure)).not.toContain('secret-branch')
  })

  it('retains an undefined rejection as primary while cleanup still aggregates', async () => {
    const f = fixture()
    const run = createTransactionalDbSuite('accept-path', {
      ...f.deps,
      observeSentinelAbsent: async () => { throw new Error('cleanup-detail') },
    })
    await f.setup()

    const failure = await run(async () => Promise.reject()).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors[0]).toBeUndefined()
    expect((failure as AggregateError).errors[1]).toMatchObject({ code: 'DB_CONTRACT_SENTINEL_LEAK_UNPROVEN' })
    expect(f.events).toContain('ROLLBACK')
    expect(f.events).toContain('release')
  })

  it('fails suite teardown when 404 deletion proof is unavailable', async () => {
    const f = fixture()
    const run = createTransactionalDbSuite('accept-path', {
      ...f.deps,
      deleteBranch: async () => { throw new Error('raw-control-plane-body') },
    })
    void run
    await f.setup()

    await expect(f.teardown()).rejects.toEqual(
      expect.objectContaining({ code: 'DB_CONTRACT_BRANCH_DELETION_UNPROVEN' }),
    )
  })

  it('does not delete a setup-failed branch twice after strict deletion succeeds', async () => {
    const f = fixture()
    const deleteBranch = vi.fn(async () => undefined)
    createTransactionalDbSuite('accept-path', {
      ...f.deps,
      prepare: async () => { throw new Error('migration failed') },
      deleteBranch,
    })

    await expect(f.setup()).rejects.toThrow('migration failed')
    await f.teardown()
    expect(deleteBranch).toHaveBeenCalledOnce()
  })

  it('closes the pool and redacts a pinned connection failure', async () => {
    const end = vi.fn(async () => undefined)
    const pool = {
      connect: vi.fn(async () => { throw new Error('postgres://secret') }),
      end,
    }

    await expect(connectPinnedForTest('postgres://secret', () => pool)).rejects.toMatchObject({
      code: 'DB_CONTRACT_SESSION_CONNECT_FAILED',
    })
    expect(end).toHaveBeenCalledOnce()
  })

  it('aggregates a connection failure with an unproven pool close without leaking details', async () => {
    const pool = {
      connect: vi.fn(async () => { throw new Error('postgres://connect-secret') }),
      end: vi.fn(async () => { throw new Error('postgres://close-secret') }),
    }

    const failure = await connectPinnedForTest('postgres://uri-secret', () => pool).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = failure as AggregateError
    expect(aggregate.message).toBe('DB_CONTRACT_TEST_AND_CLEANUP_FAILED')
    expect(aggregate.errors).toEqual([
      expect.objectContaining({ code: 'DB_CONTRACT_SESSION_CONNECT_FAILED' }),
      expect.objectContaining({ code: 'DB_CONTRACT_POOL_CLOSE_UNPROVEN' }),
    ])
    for (const nested of aggregate.errors) {
      expect(nested).toBeInstanceOf(Error)
      expect((nested as Error).message).not.toContain('secret')
    }
  })

  it('fails closed when a test runs before suite setup', async () => {
    const f = fixture()
    const run = createTransactionalDbSuite('accept-path', f.deps)
    await expect(run(async () => undefined)).rejects.toEqual(
      new SuiteResourceError('DB_CONTRACT_SUITE_NOT_READY'),
    )
  })
})

describe('required branch ownership and cleanup', () => {
  it('mints a TTL branch and recognizes only the exact current run token', async () => {
    process.env.NEON_API_KEY = 'unit-key'
    process.env.NEON_PROJECT_ID = 'unit-project'
    process.env.DB_CONTRACT_RUN_TOKEN = 'run-42'
    let requestBody: { branch?: { name?: string; expires_at?: string } } = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body)) as typeof requestBody
      return {
        ok: true,
        status: 201,
        json: async () => ({ branch: { id: 'secret-id' }, connection_uris: [{ connection_uri: 'secret-uri' }] }),
      } as Response
    }))

    await createEphemeralBranch(suiteBranchPrefix('memory tier'))

    expect(requestBody.branch?.expires_at).toBeTruthy()
    expect(isCurrentRunBranchName(requestBody.branch?.name, 'run-42')).toBe(true)
    expect(isCurrentRunBranchName(requestBody.branch?.name, 'run-4')).toBe(false)
    expect(isCurrentRunBranchName('db-contract--run-42--memory-tier', 'run-42')).toBe(false)
  })

  it('does not alias distinct run tokens with the same leading characters', () => {
    const first = 'abcdefghijkl-1'
    const second = 'abcdefghijkl-2'
    const name = `${suiteBranchPrefix('memory-tier', { DB_CONTRACT_RUN_TOKEN: first } as NodeJS.ProcessEnv)}-1700000000000-abcdef01`

    expect(isCurrentRunBranchName(name, first)).toBe(true)
    expect(isCurrentRunBranchName(name, second)).toBe(false)
  })

  it('uses the raw environment token exactly once in zero-argument cleanup proof', async () => {
    process.env.NEON_API_KEY = 'unit-key'
    process.env.NEON_PROJECT_ID = 'unit-project'
    process.env.DB_CONTRACT_RUN_TOKEN = 'raw-current-run'
    const name = `${suiteBranchPrefix('memory-tier')}-1700000000000-abcdef01`
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ branches: [{ id: 'secret-id', name }] }),
    } as Response)))

    await expect(assertCurrentRunBranchesAbsent()).rejects.toThrow(
      'DB_CONTRACT_CURRENT_RUN_CLEANUP_INCOMPLETE',
    )
  })

  it('requires a post-delete 404 proof', async () => {
    process.env.NEON_API_KEY = 'unit-key'
    process.env.NEON_PROJECT_ID = 'unit-project'
    const statuses = [202, 200, 404]
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      const status = statuses.shift() ?? 404
      return { ok: status >= 200 && status < 300, status } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await deleteEphemeralBranchStrict('secret-id', 1_000)

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['DELETE', 'GET', 'GET'])
    const signals = fetchMock.mock.calls.map((call) => call[1]?.signal)
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
    expect(new Set(signals).size).toBe(signals.length)
  })

  it('preserves a strict Neon cleanup error code in the dedicated harness', () => {
    const error = new NeonBranchError('DB_CONTRACT_BRANCH_DELETE_FAILED')
    expect(dedicatedCleanupFailure(error)).toBe(error)
  })

  it('strictly deletes a retained branch when create operations fail', async () => {
    process.env.NEON_API_KEY = 'unit-key'
    process.env.NEON_PROJECT_ID = 'unit-project'
    process.env.DB_CONTRACT_RUN_TOKEN = 'run-42'
    const methods: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      methods.push(method)
      if (method === 'POST') return {
        ok: true,
        status: 201,
        json: async () => ({
          branch: { id: 'secret-branch' },
          connection_uris: [{ connection_uri: 'secret-uri' }],
          operations: [{ id: 'secret-operation', action: 'secret-action', status: 'failed' }],
        }),
      } as Response
      if (method === 'DELETE') return { ok: true, status: 202 } as Response
      return { ok: false, status: 404 } as Response
    }))

    await expect(createEphemeralBranch(suiteBranchPrefix('failed-create'))).rejects.toThrow(
      'DB_CONTRACT_BRANCH_CREATE_INCOMPLETE',
    )
    expect(methods).toEqual(['POST', 'DELETE', 'GET'])
  })

  it('aggregates retained-branch create and cleanup failures without secret details', async () => {
    process.env.NEON_API_KEY = 'unit-key'
    process.env.NEON_PROJECT_ID = 'unit-project'
    process.env.DB_CONTRACT_RUN_TOKEN = 'run-42'
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return {
        ok: true,
        status: 201,
        json: async () => ({ branch: { id: 'secret-branch' } }),
      } as Response
      return { ok: false, status: 500, text: async () => 'raw-response-secret' } as Response
    }))

    const failure = await createEphemeralBranch(suiteBranchPrefix('failed-cleanup')).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors.map((error) => (error as { code?: string }).code)).toEqual([
      'DB_CONTRACT_BRANCH_CREATE_INCOMPLETE',
      'DB_CONTRACT_BRANCH_DELETION_UNPROVEN',
    ])
    expect(JSON.stringify(failure)).not.toMatch(/secret-branch|unit-project|raw-response-secret/)
    expect(warning).not.toHaveBeenCalled()
  })

  it('requires an explicit authoritative branch cap', async () => {
    process.env.NEON_API_KEY = 'unit-key'
    process.env.NEON_PROJECT_ID = 'unit-project'
    delete process.env.DB_CONTRACT_BRANCH_CAP
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ branches: [] }),
    } as Response)))

    await expect(preflightBranchCapacity()).rejects.toThrow('DB_CONTRACT_BRANCH_CAP_UNAVAILABLE')
    process.env.DB_CONTRACT_BRANCH_CAP = 'unknown'
    await expect(preflightBranchCapacity()).rejects.toThrow('DB_CONTRACT_BRANCH_CAP_UNAVAILABLE')
    process.env.DB_CONTRACT_BRANCH_CAP = '10'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as Response)))
    await expect(preflightBranchCapacity()).rejects.toThrow('DB_CONTRACT_BRANCH_CAPACITY_UNAVAILABLE')
  })

  it('rejects invalid required branch counts before listing branches', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ branches: [] }),
    } as Response))
    vi.stubGlobal('fetch', fetch)
    const runtime = {
      runToken: 'unit-run',
      branchCap: 10,
      exactHead: 'unit-head',
      telemetryPath: 'unit-telemetry.json',
    }

    for (const required of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const failure = await preflightBranchCapacity(required, runtime).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'DB_CONTRACT_BRANCH_CAPACITY_UNAVAILABLE' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails closed on credentials/reap and final teardown proves the exact run absent', async () => {
    const base = {
      env: {} as NodeJS.ProcessEnv,
      reap: vi.fn(async () => ({ complete: true, scanned: 0, deleted: [], failed: [] })),
      preflight: vi.fn(async () => undefined),
      assertCurrentRunAbsent: vi.fn(async () => undefined),
      makeRunToken: () => 'exact-run',
    }
    await expect(runRequiredSetup(base)).rejects.toThrow('DB_CONTRACT_CREDENTIALS_UNAVAILABLE')

    const deps = { ...base, env: { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'project' } as NodeJS.ProcessEnv }
    const teardown = await runRequiredSetup(deps)
    await teardown()
    expect(deps.preflight).toHaveBeenCalledOnce()
    expect(deps.assertCurrentRunAbsent).toHaveBeenCalledWith('exact-run')

    await expect(runRequiredSetup({
      ...deps,
      reap: async () => ({ complete: false, scanned: 0, deleted: [], failed: [] }),
    })).rejects.toThrow('DB_CONTRACT_STALE_REAP_INCOMPLETE')
  })

  it('provides one normalized runtime config to workers, preflight, and telemetry', async () => {
    const provide = vi.fn()
    const preflight = vi.fn(async () => undefined)
    const env = {
      NEON_API_KEY: 'key',
      NEON_PROJECT_ID: 'project',
      DB_CONTRACT_BRANCH_CAP: '10',
      DB_CONTRACT_EXACT_HEAD: 'a'.repeat(40),
      DB_CONTRACT_TELEMETRY_PATH: 'runtime-telemetry.json',
    } as NodeJS.ProcessEnv

    await runRequiredSetup({
      env,
      reap: async () => ({ complete: true, scanned: 0, deleted: [], failed: [] }),
      preflight,
      assertCurrentRunAbsent: async () => undefined,
      makeRunToken: () => 'generated-token',
      provide,
    })

    const runtime = {
      runToken: 'generated-token',
      branchCap: 10,
      exactHead: 'a'.repeat(40),
      telemetryPath: resolve('runtime-telemetry.json'),
    }
    expect(provide).toHaveBeenCalledWith('dbContractRuntime', runtime)
    expect(preflight).toHaveBeenCalledWith(runtime)
    expect(env.DB_CONTRACT_RUN_TOKEN).toBe('generated-token')
  })
})
