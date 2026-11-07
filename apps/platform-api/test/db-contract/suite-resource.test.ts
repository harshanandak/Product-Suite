import diagnosticsChannel from 'node:diagnostics_channel'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { neon, neonConfig } from '@neondatabase/serverless'
import type { Sql } from '@product-suite/db'

import {
  connectPinnedForTest,
  createTransactionalDbSuite,
  SuiteResourceError,
  type TransactionalDbDependencies,
} from './suite-resource'
import {
  applyHarnessMigrationFile,
  dedicatedCleanupFailure,
  finishDedicatedBranchLifecycle,
  handleDedicatedCreateFailure,
  prepareHarnessDatabase,
  withDedicatedDbBranch,
  type DedicatedDbDependencies,
} from './harness'
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
import { initializeTelemetry, readTelemetry } from './telemetry'

type Hook = () => Promise<void>

const originalEnv = { ...process.env }
const temporaryRoots: string[] = []
const transportChannelNames = [
  'undici:request:create',
  'undici:request:headers',
  'undici:request:error',
  'undici:client:connectError',
] as const
const diagnosticRuntime = {
  node: process.version,
  undici: process.versions.undici ?? 'unknown',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  process.env = { ...originalEnv }
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
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
  const releaseLease = vi.fn(async () => undefined)
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
    acquireLease: vi.fn(async () => ({
      id: 'lease-id', ownerId: 'lease-owner', kind: 'suite' as const, release: releaseLease,
    })),
  }
  return { deps, events, client, releaseLease, get setup() { return setup }, get teardown() { return teardown } }
}

function dedicatedFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'db-contract-dedicated-'))
  temporaryRoots.push(root)
  const telemetryPath = resolve(root, 'telemetry.json')
  initializeTelemetry(telemetryPath, { exactHead: 'd'.repeat(40), concurrency: 2 })
  process.env.DB_CONTRACT_TELEMETRY_PATH = telemetryPath
  process.env.DB_CONTRACT_LEASE_ROOT = resolve(root, 'leases')
  process.env.DB_CONTRACT_RUN_TOKEN = 'unit-dedicated-run'
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('DB_CONTRACT_UNIT_LIVE_CALL_BLOCKED') }))

  const events: string[] = []
  const release = vi.fn(async () => { events.push('release') })
  const branch = {
    branchId: 'secret-branch-id',
    connectionUri: 'postgres://unit:credential@secret.example/unit',
  }
  const seed = { tenantId: 'secret-tenant-id' } as never
  const dependencies: DedicatedDbDependencies = {
    acquireLease: vi.fn(async () => {
      events.push('lease')
      return {
        id: 'secret-lease-id',
        ownerId: 'secret-owner-id',
        kind: 'dedicated' as const,
        release,
      }
    }),
    createBranch: vi.fn(async () => { events.push('create'); return branch }),
    createSql: vi.fn(() => ({}) as never),
    createDb: vi.fn(() => ({}) as never),
    prepare: vi.fn(async () => { events.push('prepare') }),
    seed: vi.fn(async () => { events.push('seed'); return seed }),
    deleteBranch: vi.fn(async () => { events.push('delete') }),
  }
  return { branch, dependencies, events, release, telemetryPath }
}

function transportSubscriberState(): boolean[] {
  return transportChannelNames.map((name) => diagnosticsChannel.channel(name).hasSubscribers)
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  return (server.address() as AddressInfo).port
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
}

async function rejectedHandshakeServer(status: 429 | 503): Promise<{ server: Server; port: number }> {
  const server = createServer()
  server.on('upgrade', (_request, socket) => {
    socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
  })
  return { server, port: await listen(server) }
}

async function webSocketFailure(port: number): Promise<void> {
  await new Promise<void>((resolveFailure, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/probe`)
    const timer = setTimeout(() => reject(new Error('LOOPBACK_WEBSOCKET_TIMEOUT')), 2_000)
    const finish = (): void => {
      clearTimeout(timer)
      try { socket.close() } catch {}
      resolveFailure()
    }
    socket.addEventListener('error', finish, { once: true })
    socket.addEventListener('close', finish, { once: true })
    socket.addEventListener('open', () => reject(new Error('LOOPBACK_WEBSOCKET_UNEXPECTED_OPEN')), { once: true })
  })
}

describe('harness migration execution', () => {
  it('batches every inner statement of an explicit transaction wrapper in order', async () => {
    const inner = Array.from({ length: 143 }, (_, index) => (
      index === 0 ? 'select role_preflight' : `select migration_step_${index}`
    ))
    const built: string[] = []
    const query = vi.fn(async () => [])
    const transaction = vi.fn(async (build: (tx: { query(text: string): unknown }) => unknown[]) => {
      const descriptors = build({
        query(text) {
          built.push(text)
          return { text }
        },
      })
      expect(descriptors).toEqual(inner.map((text) => ({ text })))
      return []
    })

    await applyHarnessMigrationFile(
      { query, transaction } as unknown as Sql,
      [' BEGIN; ', ...inner, ' COMMIT; '].join('--> statement-breakpoint'),
    )

    expect(transaction).toHaveBeenCalledOnce()
    expect(built).toEqual(inner)
    expect(query).not.toHaveBeenCalled()
  })

  it('sends lazy transaction descriptors through one installed Neon HTTP batch request', async () => {
    const bodies: Array<{ queries?: Array<{ query?: string }> }> = []
    const originalFetch = neonConfig.fetchFunction
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { queries?: Array<{ query?: string }> }
      bodies.push(body)
      return new Response(JSON.stringify({
        results: (body.queries ?? []).map(() => ({ fields: [], rows: [], rowCount: 0, command: 'SELECT' })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    neonConfig.fetchFunction = fakeFetch
    try {
      const sql = neon('postgresql://fixture:opaque@fixture.invalid/neondb')
      await applyHarnessMigrationFile(
        sql as unknown as Sql,
        'BEGIN;--> statement-breakpoint\nselect 1;--> statement-breakpoint\nselect 2;--> statement-breakpoint\nCOMMIT;',
      )
    } finally {
      neonConfig.fetchFunction = originalFetch
    }

    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.queries?.map((query) => query.query)).toEqual(['select 1;', 'select 2;'])
  })

  it.each([
    ['ordinary migration', ['select first', 'select second']],
    ['missing commit', ['BEGIN;', 'select first']],
    ['missing begin', ['select first', 'COMMIT;']],
    ['empty wrapper', ['BEGIN;', 'COMMIT;']],
  ])('keeps %s on sequential execution', async (_label, statements) => {
    const calls: string[] = []
    const query = vi.fn(async (text: string) => {
      calls.push(text)
      return []
    })
    const transaction = vi.fn()

    await applyHarnessMigrationFile(
      { query, transaction } as unknown as Sql,
      statements.join('--> statement-breakpoint'),
    )

    expect(calls).toEqual(statements)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('records the journal only after the explicit transaction resolves', async () => {
    const events: string[] = []
    const transaction = vi.fn(async (build: (tx: { query(text: string): unknown }) => unknown[]) => {
      const descriptors = build({ query: (text) => ({ text }) })
      expect(descriptors).toEqual([{ text: 'select first;' }, { text: 'select second;' }])
      events.push('transaction')
      return []
    })

    await applyHarnessMigrationFile(
      { query: vi.fn(), transaction } as unknown as Sql,
      'BEGIN;--> statement-breakpoint\nselect first;--> statement-breakpoint\nselect second;--> statement-breakpoint\nCOMMIT;',
      async () => { events.push('journal') },
    )

    expect(events).toEqual(['transaction', 'journal'])
  })

  it('preserves a transaction failure and does not record or start a later migration', async () => {
    const primary = new Error('transaction failed')
    const recordJournal = vi.fn(async () => undefined)
    const later = vi.fn(async () => undefined)
    const sql = {
      query: vi.fn(),
      transaction: vi.fn(async (build: (tx: { query(text: string): unknown }) => unknown[]) => {
        build({ query: (text) => ({ text }) })
        throw primary
      }),
    } as unknown as Sql

    const run = async (): Promise<void> => {
      await applyHarnessMigrationFile(
        sql,
        'BEGIN;--> statement-breakpoint\nselect first;--> statement-breakpoint\nselect second;--> statement-breakpoint\nCOMMIT;',
        recordJournal,
      )
      await later()
    }

    await expect(run()).rejects.toBe(primary)
    expect(recordJournal).not.toHaveBeenCalled()
    expect(later).not.toHaveBeenCalled()
  })
})

describe('transactional suite resource', () => {
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
    expect(f.releaseLease).toHaveBeenCalledOnce()
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
    expect(f.releaseLease).not.toHaveBeenCalled()
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

  it('preserves a setup failure when strict deletion succeeds but suite lease release fails', async () => {
    const f = fixture()
    const primary = new Error('setup-failure')
    f.releaseLease.mockRejectedValue(new Error('postgres://lease-secret'))
    createTransactionalDbSuite('accept-path', {
      ...f.deps,
      prepare: async () => { throw primary },
    })

    const failure = await f.setup().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([
      primary,
      expect.objectContaining({ code: 'DB_CONTRACT_BRANCH_LEASE_RELEASE_UNPROVEN' }),
    ])
    expect(String((failure as AggregateError).errors[1])).not.toContain('lease-secret')
  })

  it('preserves a dedicated primary failure when strict deletion succeeds but lease release fails', async () => {
    const primary = new Error('test-failure')
    const lease = {
      id: 'lease-id',
      ownerId: 'lease-owner',
      kind: 'dedicated' as const,
      release: vi.fn(async () => { throw new Error('postgres://lease-secret') }),
    }
    const failure = await finishDedicatedBranchLifecycle(
      'branch-id', lease, primary, true, async () => undefined,
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([
      primary,
      expect.objectContaining({ code: 'DB_CONTRACT_BRANCH_LEASE_RELEASE_UNPROVEN' }),
    ])
    expect(String((failure as AggregateError).errors[1])).not.toContain('lease-secret')
  })

  it('releases the suite lease only when failed creation proves branch absence', async () => {
    const f = fixture()
    const absenceProven = new NeonBranchError('DB_CONTRACT_BRANCH_CREATE_INCOMPLETE', { absenceProven: true })
    createTransactionalDbSuite('accept-path', {
      ...f.deps,
      createBranch: async () => { throw absenceProven },
    })

    await expect(f.setup()).rejects.toBe(absenceProven)
    expect(f.releaseLease).toHaveBeenCalledOnce()

    const failing = fixture()
    failing.releaseLease.mockRejectedValue(new Error('postgres://release-secret'))
    createTransactionalDbSuite('accept-path', {
      ...failing.deps,
      createBranch: async () => { throw absenceProven },
    })
    const aggregate = await failing.setup().catch((error: unknown) => error) as AggregateError
    expect(aggregate.errors).toEqual([
      absenceProven,
      expect.objectContaining({ code: 'DB_CONTRACT_BRANCH_LEASE_RELEASE_UNPROVEN' }),
    ])
  })

  it('releases the dedicated lease only for an absence-proven create error', async () => {
    const absenceProven = new NeonBranchError('DB_CONTRACT_BRANCH_CREATE_INCOMPLETE', { absenceProven: true })
    const release = vi.fn(async () => undefined)
    const lease = { id: 'lease-id', ownerId: 'owner-id', kind: 'dedicated' as const, release }

    await expect(handleDedicatedCreateFailure(absenceProven, lease)).rejects.toBe(absenceProven)
    expect(release).toHaveBeenCalledOnce()

    release.mockClear()
    const indeterminate = new NeonBranchError('DB_CONTRACT_NEON_REQUEST_INDETERMINATE')
    await expect(handleDedicatedCreateFailure(indeterminate, lease)).rejects.toBe(indeterminate)
    expect(release).not.toHaveBeenCalled()

    const failedRelease = { ...lease, release: vi.fn(async () => { throw new Error('postgres://release-secret') }) }
    const aggregate = await handleDedicatedCreateFailure(absenceProven, failedRelease)
      .catch((error: unknown) => error) as AggregateError
    expect(aggregate.errors).toEqual([
      absenceProven,
      expect.objectContaining({ code: 'DB_CONTRACT_BRANCH_LEASE_RELEASE_UNPROVEN' }),
    ])
  })

  it('closes the pool and redacts a pinned connection failure', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const end = vi.fn(async () => undefined)
    const transport = Object.assign(new Error('postgres://secret-host/unit'), { code: 'ECONNRESET' })
    const pool = {
      connect: vi.fn(async () => { throw transport }),
      end,
    }

    await expect(connectPinnedForTest('postgres://secret', () => pool)).rejects.toMatchObject({
      code: 'DB_CONTRACT_SESSION_CONNECT_FAILED',
    })
    expect(end).toHaveBeenCalledOnce()
    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'session-connect',
      transport: 'websocket',
      code: 'ECONNRESET',
      status: 'unknown',
      runtime: diagnosticRuntime,
    })
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/secret-host|postgres:/)
  })

  it('closes the pool and returns the stable session error when diagnostic logging fails', async () => {
    const subscribers = transportSubscriberState()
    vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('logger unavailable') })
    const end = vi.fn(async () => undefined)
    const pool = {
      connect: vi.fn(async () => { throw new Error('postgres://connect-secret') }),
      end,
    }

    const failure = await connectPinnedForTest('postgres://uri-secret', () => pool).catch((error: unknown) => error)

    expect(failure).toEqual(expect.objectContaining({ code: 'DB_CONTRACT_SESSION_CONNECT_FAILED' }))
    expect(end).toHaveBeenCalledOnce()
    expect(transportSubscriberState()).toEqual(subscribers)
  })

  it.each([429, 503] as const)(
    'uses passive Undici HTTP %s evidence when the surfaced session error has no status',
    async (status) => {
      const subscribers = transportSubscriberState()
      const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { server, port } = await rejectedHandshakeServer(status)
      const end = vi.fn(async () => undefined)
      try {
        const failure = await connectPinnedForTest('postgres://secret', () => ({
          connect: async () => {
            await webSocketFailure(port)
            throw new Error('generic session failure')
          },
          end,
        })).catch((error: unknown) => error)

        expect(failure).toEqual(expect.objectContaining({ code: 'DB_CONTRACT_SESSION_CONNECT_FAILED' }))
        expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
          phase: 'session-connect',
          transport: 'websocket',
          code: 'unknown',
          status,
          runtime: diagnosticRuntime,
        })
        expect(end).toHaveBeenCalledOnce()
      } finally {
        await closeServer(server)
      }
      expect(transportSubscriberState()).toEqual(subscribers)
    },
  )

  it('uses passive Undici connection evidence when the surfaced session error has no code', async () => {
    const subscribers = transportSubscriberState()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const server = createServer()
    const port = await listen(server)
    await closeServer(server)
    const end = vi.fn(async () => undefined)

    const failure = await connectPinnedForTest('postgres://secret', () => ({
      connect: async () => {
        await webSocketFailure(port)
        throw new Error('generic session failure')
      },
      end,
    })).catch((error: unknown) => error)

    expect(failure).toEqual(expect.objectContaining({ code: 'DB_CONTRACT_SESSION_CONNECT_FAILED' }))
    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'session-connect',
      transport: 'websocket',
      code: 'ECONNREFUSED',
      status: 'unknown',
      runtime: diagnosticRuntime,
    })
    expect(end).toHaveBeenCalledOnce()
    expect(transportSubscriberState()).toEqual(subscribers)
  })

  it('keeps surfaced evidence ahead of passive Undici evidence', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { server, port } = await rejectedHandshakeServer(503)
    try {
      await connectPinnedForTest('postgres://secret', () => ({
        connect: async () => {
          await webSocketFailure(port)
          throw Object.assign(new Error('primary session failure'), { code: 'ETIMEDOUT', status: 418 })
        },
        end: async () => undefined,
      })).catch(() => undefined)
    } finally {
      await closeServer(server)
    }

    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'session-connect',
      transport: 'websocket',
      code: 'ETIMEDOUT',
      status: 418,
      runtime: diagnosticRuntime,
    })
  })

  it('ignores an overlapping unrelated Undici request', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unrelated = await rejectedHandshakeServer(503)
    const scoped = await rejectedHandshakeServer(429)
    let markStarted: () => void = () => undefined
    let releaseScoped: () => void = () => undefined
    const started = new Promise<void>((resolveStarted) => { markStarted = resolveStarted })
    const gate = new Promise<void>((resolveGate) => { releaseScoped = resolveGate })
    try {
      const attempt = connectPinnedForTest('postgres://secret', () => ({
        connect: async () => {
          markStarted()
          await gate
          await webSocketFailure(scoped.port)
          throw new Error('generic session failure')
        },
        end: async () => undefined,
      })).catch((error: unknown) => error)

      await started
      await webSocketFailure(unrelated.port)
      releaseScoped()
      await expect(attempt).resolves.toEqual(expect.objectContaining({ code: 'DB_CONTRACT_SESSION_CONNECT_FAILED' }))
    } finally {
      releaseScoped()
      await Promise.all([closeServer(unrelated.server), closeServer(scoped.server)])
    }

    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'session-connect',
      transport: 'websocket',
      code: 'unknown',
      status: 429,
      runtime: diagnosticRuntime,
    })
  })

  it('reports unknown passive evidence and releases listeners when no channel fires', async () => {
    const subscribers = transportSubscriberState()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const end = vi.fn(async () => undefined)

    await connectPinnedForTest('postgres://secret', () => ({
      connect: async () => { throw new Error('unsupported transport failure') },
      end,
    })).catch(() => undefined)

    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'session-connect',
      transport: 'websocket',
      code: 'unknown',
      status: 'unknown',
      runtime: diagnosticRuntime,
    })
    expect(end).toHaveBeenCalledOnce()
    expect(transportSubscriberState()).toEqual(subscribers)
  })

  it('releases passive listeners after a successful session connection', async () => {
    const subscribers = transportSubscriberState()
    const end = vi.fn(async () => undefined)
    const release = vi.fn()
    const client = await connectPinnedForTest('postgres://secret', () => ({
      connect: async () => ({ query: vi.fn(), release }),
      end,
    }))

    expect(transportSubscriberState()).toEqual(subscribers)
    await client.release()
    expect(release).toHaveBeenCalledOnce()
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

describe('secret-safe transport diagnostics', () => {
  it('preserves the preparation error when diagnostic logging fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('logger unavailable') })
    const primary = new Error('postgres://preparation-secret')

    const failure = await prepareHarnessDatabase('postgres://secret', {} as never, {
      provisionRoles: async () => { throw primary },
      applyMigrations: async () => undefined,
    }).catch((error: unknown) => error)

    expect(failure).toBe(primary)
  })

  it('reports a dedicated WebSocket preparation failure and preserves its identity', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    class TestErrorEvent extends Event {
      #nested: unknown

      constructor(error: unknown) {
        super('error')
        this.#nested = error
      }

      get error(): unknown {
        return this.#nested
      }
    }
    const primary = new TestErrorEvent(Object.assign(new Error('private response'), { code: 'ETIMEDOUT' }))

    const failure = await prepareHarnessDatabase('postgres://secret', {} as never, {
      provisionRoles: async () => { throw primary },
      applyMigrations: async () => undefined,
    }).catch((error: unknown) => error)

    expect(failure).toBe(primary)
    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'prepare',
      transport: 'websocket',
      code: 'ETIMEDOUT',
      status: 'unknown',
      runtime: diagnosticRuntime,
    })
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/secret-host|private response|postgres:|wss:/)
  })

  it('reports an HTTP migration source failure without reading unsafe fields', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const sourceError = Object.assign(new Error('https://secret-host/sql'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
      status: 503,
    })
    Object.defineProperty(sourceError, 'url', {
      get: () => { throw new Error('unsafe getter was read') },
    })
    sourceError.cause = sourceError
    const primary = Object.assign(new Error('database credential detail'), { sourceError })

    const failure = await prepareHarnessDatabase('postgres://secret', {} as never, {
      provisionRoles: async () => undefined,
      applyMigrations: async () => { throw primary },
    }).catch((error: unknown) => error)

    expect(failure).toBe(primary)
    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'prepare',
      transport: 'http',
      code: 'UND_ERR_CONNECT_TIMEOUT',
      status: 503,
      runtime: diagnosticRuntime,
    })
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/secret-host|credential|postgres:|https:/)
  })

  it('rejects unsafe codes and statuses without invoking accessors', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const primary = Object.assign(Object.create(null) as Record<string, unknown>, {
      code: 'postgres://credential-host/private',
      errno: 'SECRET_TOKEN',
      status: 600,
      statusCode: '503',
    })
    primary.sourceError = primary
    Object.defineProperty(primary, 'cause', {
      get: () => { throw new Error('credential getter invoked') },
    })

    const failure = await prepareHarnessDatabase('postgres://secret', {} as never, {
      provisionRoles: async () => { throw primary },
      applyMigrations: async () => undefined,
    }).catch((error: unknown) => error)

    expect(failure).toBe(primary)
    expect(diagnostic).toHaveBeenCalledWith('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', {
      phase: 'prepare',
      transport: 'websocket',
      code: 'unknown',
      status: 'unknown',
      runtime: diagnosticRuntime,
    })
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/credential|SECRET_TOKEN|postgres:/)
  })
})

describe('dedicated branch lifecycle telemetry', () => {
  it('records one create, prepare, and delete phase without serializing lifecycle secrets', async () => {
    const f = dedicatedFixture()

    const value = await withDedicatedDbBranch(async ({ branchId }) => {
      f.events.push('body')
      expect(branchId).toBe(f.branch.branchId)
      return 'ok'
    }, f.dependencies)

    expect(value).toBe('ok')
    expect(f.events).toEqual(['lease', 'create', 'prepare', 'seed', 'body', 'delete', 'release'])
    expect(f.dependencies.createBranch).toHaveBeenCalledOnce()
    expect(f.dependencies.prepare).toHaveBeenCalledOnce()
    expect(f.dependencies.deleteBranch).toHaveBeenCalledOnce()
    expect(f.release).toHaveBeenCalledOnce()
    expect(readTelemetry(f.telemetryPath).phases).toMatchObject({
      create: { count: 1, durationMs: expect.any(Number) },
      prepare: { count: 1, durationMs: expect.any(Number) },
      delete: { count: 1, durationMs: expect.any(Number) },
    })
    expect(Object.keys(readTelemetry(f.telemetryPath).phases).sort()).toEqual(['create', 'delete', 'prepare'])
    expect(readFileSync(f.telemetryPath, 'utf8')).not.toMatch(
      /secret-branch-id|secret-lease-id|secret-owner-id|secret-tenant-id|secret\.example|credential/,
    )
  })

  it.each(['prepare', 'body'] as const)(
    'preserves the %s failure while measuring strict deletion before lease release',
    async (stage) => {
      const f = dedicatedFixture()
      const primary = new Error(`postgres://primary-${stage}-detail@secret.example`)
      if (stage === 'prepare') {
        f.dependencies.prepare = vi.fn(async () => { f.events.push('prepare'); throw primary })
      }

      const failure = await withDedicatedDbBranch(async () => {
        f.events.push('body')
        if (stage === 'body') throw primary
      }, f.dependencies).catch((error: unknown) => error)

      expect(failure).toBe(primary)
      expect(f.dependencies.deleteBranch).toHaveBeenCalledWith(f.branch.branchId)
      expect(f.release).toHaveBeenCalledOnce()
      expect(f.events.indexOf('release')).toBeGreaterThan(f.events.indexOf('delete'))
      expect(readTelemetry(f.telemetryPath).phases).toMatchObject({
        create: { count: 1 },
        prepare: { count: 1 },
        delete: { count: 1 },
      })
      expect(readFileSync(f.telemetryPath, 'utf8')).not.toMatch(
        /secret-branch-id|secret-lease-id|secret-owner-id|secret-tenant-id|secret\.example|primary-.*-detail|credential/,
      )
    },
  )

  it('strictly deletes a created branch when recording its create timing fails', async () => {
    const f = dedicatedFixture()
    f.dependencies.createBranch = vi.fn(async () => {
      f.events.push('create')
      writeFileSync(f.telemetryPath, 'invalid telemetry')
      return f.branch
    })
    f.dependencies.deleteBranch = vi.fn(async () => {
      f.events.push('delete')
      initializeTelemetry(f.telemetryPath, { exactHead: 'd'.repeat(40), concurrency: 2 })
    })
    const body = vi.fn(async () => undefined)

    const failure = await withDedicatedDbBranch(body, f.dependencies).catch((error: unknown) => error)

    expect(failure).toMatchObject({ name: 'TelemetryError', message: 'DB_CONTRACT_TELEMETRY_INVALID' })
    expect(body).not.toHaveBeenCalled()
    expect(f.dependencies.deleteBranch).toHaveBeenCalledWith(f.branch.branchId)
    expect(f.events).toEqual(['lease', 'create', 'delete', 'release'])
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('aggregates a create-timing failure with strict deletion failure and retains the lease', async () => {
    const f = dedicatedFixture()
    const cleanup = new NeonBranchError('DB_CONTRACT_BRANCH_DELETION_UNPROVEN')
    f.dependencies.createBranch = vi.fn(async () => {
      f.events.push('create')
      writeFileSync(f.telemetryPath, 'invalid telemetry')
      return f.branch
    })
    f.dependencies.deleteBranch = vi.fn(async () => {
      f.events.push('delete')
      initializeTelemetry(f.telemetryPath, { exactHead: 'd'.repeat(40), concurrency: 2 })
      throw cleanup
    })

    const failure = await withDedicatedDbBranch(async () => undefined, f.dependencies)
      .catch((error: unknown) => error) as AggregateError

    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors).toEqual([
      expect.objectContaining({ name: 'TelemetryError', message: 'DB_CONTRACT_TELEMETRY_INVALID' }),
      cleanup,
    ])
    expect(f.dependencies.deleteBranch).toHaveBeenCalledWith(f.branch.branchId)
    expect(f.release).not.toHaveBeenCalled()
  })

  it('preserves an absence-proven create error when recording its timing also fails', async () => {
    const f = dedicatedFixture()
    const createFailure = new NeonBranchError('DB_CONTRACT_BRANCH_CREATE_INCOMPLETE', { absenceProven: true })
    f.dependencies.createBranch = vi.fn(async () => {
      f.events.push('create')
      writeFileSync(f.telemetryPath, 'invalid telemetry')
      throw createFailure
    })

    const failure = await withDedicatedDbBranch(async () => undefined, f.dependencies)
      .catch((error: unknown) => error)

    expect(failure).toBe(createFailure)
    expect(f.dependencies.deleteBranch).not.toHaveBeenCalled()
    expect(f.release).toHaveBeenCalledOnce()
    expect(f.events).toEqual(['lease', 'create', 'release'])
  })

  it.each([false, true])(
    'releases after proven deletion when recording its timing fails (primary: %s)',
    async (withPrimary) => {
      const f = dedicatedFixture()
      const primary = new Error('primary failure')
      f.dependencies.deleteBranch = vi.fn(async () => {
        f.events.push('delete')
        writeFileSync(f.telemetryPath, 'invalid telemetry')
      })

      const failure = await withDedicatedDbBranch(async () => {
        f.events.push('body')
        if (withPrimary) throw primary
      }, f.dependencies).catch((error: unknown) => error)

      if (withPrimary) {
        expect(failure).toBeInstanceOf(AggregateError)
        expect((failure as AggregateError).errors).toEqual([
          primary,
          expect.objectContaining({ name: 'TelemetryError', message: 'DB_CONTRACT_TELEMETRY_INVALID' }),
        ])
      } else {
        expect(failure).toMatchObject({ name: 'TelemetryError', message: 'DB_CONTRACT_TELEMETRY_INVALID' })
      }
      expect(f.dependencies.deleteBranch).toHaveBeenCalledWith(f.branch.branchId)
      expect(f.release).toHaveBeenCalledOnce()
      expect(f.events.at(-1)).toBe('release')
    },
  )

  it('preserves a strict deletion error when recording its timing also fails', async () => {
    const f = dedicatedFixture()
    const cleanup = new NeonBranchError('DB_CONTRACT_BRANCH_DELETION_UNPROVEN')
    f.dependencies.deleteBranch = vi.fn(async () => {
      f.events.push('delete')
      writeFileSync(f.telemetryPath, 'invalid telemetry')
      throw cleanup
    })

    const failure = await withDedicatedDbBranch(async () => undefined, f.dependencies)
      .catch((error: unknown) => error)

    expect(failure).toBe(cleanup)
    expect(f.dependencies.deleteBranch).toHaveBeenCalledWith(f.branch.branchId)
    expect(f.release).not.toHaveBeenCalled()
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
    expect(Date.parse(requestBody.branch?.expires_at ?? '') % 1_000).toBe(0)
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

    const failure = await createEphemeralBranch(suiteBranchPrefix('failed-create')).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'DB_CONTRACT_BRANCH_CREATE_INCOMPLETE',
      absenceProven: true,
    })
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
      leaseRoot: 'unit-leases',
      databaseName: 'neondb' as const,
      roleName: 'neondb_owner' as const,
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
      leaseRoot: resolve(tmpdir(), 'product-suite-db-contract-leases'),
      databaseName: 'neondb',
      roleName: 'neondb_owner',
    }
    expect(provide).toHaveBeenCalledWith('dbContractRuntime', runtime)
    expect(preflight).toHaveBeenCalledWith(runtime)
    expect(env.DB_CONTRACT_RUN_TOKEN).toBe('generated-token')
  })
})
