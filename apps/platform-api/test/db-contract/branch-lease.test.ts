import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BranchLeaseError,
  createBranchLeaseCoordinator,
  isRetryableLockContention,
  type BranchLease,
  type BranchLeaseKind,
} from './branch-lease'

const roots: string[] = []
const DEFAULT_ACQUISITION_TIMEOUT_MS = 5_000
// Mirrors the coordinator's bounded opportunity to remove a timed-out waiter.
const WAITER_CLEANUP_OPPORTUNITY_MS = 1_000
const OBSERVER_MARGIN_MS = 250
const DEFAULT_SETTLE_TIMEOUT_MS = DEFAULT_ACQUISITION_TIMEOUT_MS
  + WAITER_CLEANUP_OPPORTUNITY_MS + OBSERVER_MARGIN_MS
const DEFAULT_TEST_TIMEOUT_MS = DEFAULT_SETTLE_TIMEOUT_MS + OBSERVER_MARGIN_MS
const DEFAULT_PENDING_OBSERVATION_MS = 50
const CHILD_READY_TIMEOUT_MS = 10_000
const CHILD_READY_CLEANUP_TIMEOUT_MS = 2_000
const CHILD_EXIT_TIMEOUT_MS = 5_000
const CHILD_SHUTDOWN_TIMEOUT_MS = CHILD_EXIT_TIMEOUT_MS * 2
// Covers every bounded phase, including failed readiness cleanup and a retried child shutdown.
const PROCESS_TEST_TIMEOUT_MS = (2 * CHILD_READY_TIMEOUT_MS)
  + CHILD_READY_CLEANUP_TIMEOUT_MS
  + (2 * DEFAULT_SETTLE_TIMEOUT_MS)
  + DEFAULT_PENDING_OBSERVATION_MS
  + (3 * CHILD_SHUTDOWN_TIMEOUT_MS)
  + DEFAULT_ACQUISITION_TIMEOUT_MS
  + OBSERVER_MARGIN_MS

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function rootWithSpaces(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'db contract leases '))
  roots.push(root)
  return root
}

function coordinator(
  rootDir: string,
  runToken = 'run-a',
  timeout = DEFAULT_ACQUISITION_TIMEOUT_MS,
  onWaiterRegisteredForTest?: () => void | Promise<void>,
) {
  return createBranchLeaseCoordinator({
    rootDir,
    runToken,
    acquisitionTimeoutMs: timeout,
    pollIntervalMs: 5,
    onWaiterRegisteredForTest,
  })
}

async function settlesWithin<T>(promise: Promise<T>, timeoutMs = DEFAULT_SETTLE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TEST_TIMEOUT')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function remainsPending(
  promise: Promise<unknown>,
  durationMs = DEFAULT_PENDING_OBSERVATION_MS,
): Promise<void> {
  const marker = Symbol('pending')
  await expect(Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(marker), durationMs))]))
    .resolves.toBe(marker)
}

function waiterRegistration() {
  let notify: () => void = () => undefined
  const observed = new Promise<void>((resolveObserved) => {
    notify = resolveObserved
  })
  return { notify, observed }
}

type ChildTermination = {
  code: number | null
  signal: NodeJS.Signals | null
}

function childTermination(child: ChildProcessWithoutNullStreams): ChildTermination | undefined {
  if (child.exitCode === null && child.signalCode === null) return undefined
  return { code: child.exitCode, signal: child.signalCode }
}

function waitForChildTermination(child: ChildProcessWithoutNullStreams): Promise<ChildTermination> {
  const termination = childTermination(child)
  if (termination) return Promise.resolve(termination)
  return new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
}

function childTerminationError({ code, signal }: ChildTermination): Error {
  return signal !== null
    ? new Error(`CHILD_SIGNAL_${signal}`)
    : new Error(`CHILD_EXIT_${String(code)}`)
}

async function childLease(rootDir: string, kind: BranchLeaseKind): Promise<ChildProcessWithoutNullStreams> {
  const source = `
    import { createBranchLeaseCoordinator } from ${JSON.stringify(pathToFileURL(resolve('test/db-contract/branch-lease.ts')).href)};
    const lease = await createBranchLeaseCoordinator({
      rootDir: process.env.LEASE_ROOT,
      runToken: 'child-run',
      acquisitionTimeoutMs: 2000,
      pollIntervalMs: 5,
    }).acquire(process.env.LEASE_KIND);
    process.stdout.write('ACQUIRED\\n');
    await new Promise((resolve) => process.stdin.once('data', resolve));
    await lease.release();
  `
  const child = spawn('bun', ['--eval', source], {
    env: { ...process.env, LEASE_ROOT: rootDir, LEASE_KIND: kind },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolveReady, reject) => {
      let output = ''
      timer = setTimeout(() => reject(new Error('CHILD_READY_TIMEOUT')), CHILD_READY_TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        output += String(chunk)
        if (output.includes('ACQUIRED')) resolveReady()
      })
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (!output.includes('ACQUIRED')) reject(childTerminationError({ code, signal }))
      })
    })
    return child
  } catch (error) {
    if (!childTermination(child)) {
      child.kill()
      await settlesWithin(waitForChildTermination(child), CHILD_READY_CLEANUP_TIMEOUT_MS)
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function releaseChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  const existingTermination = childTermination(child)
  if (existingTermination) {
    if (existingTermination.signal !== null || existingTermination.code !== 0) {
      throw childTerminationError(existingTermination)
    }
    return
  }
  const gracefulExit = waitForChildTermination(child)
  child.stdin.end('release\n')
  let termination: ChildTermination
  try {
    termination = await settlesWithin(gracefulExit, CHILD_EXIT_TIMEOUT_MS)
  } catch (error) {
    if (!childTermination(child)) child.kill()
    await settlesWithin(waitForChildTermination(child), CHILD_EXIT_TIMEOUT_MS)
    throw error
  }
  if (termination.signal !== null || termination.code !== 0) throw childTerminationError(termination)
}

describe('run-wide branch lease coordinator', { timeout: DEFAULT_TEST_TIMEOUT_MS }, () => {
  it('retries transient Windows lock contention without masking other filesystem failures', () => {
    expect(isRetryableLockContention({ code: 'EEXIST' }, 'linux')).toBe(true)
    expect(isRetryableLockContention({ code: 'EPERM' }, 'win32')).toBe(true)
    expect(isRetryableLockContention({ code: 'EPERM' }, 'linux')).toBe(false)
    expect(isRetryableLockContention({ code: 'EACCES' }, 'win32')).toBe(false)
  })

  it('contains test observer failures without awaiting asynchronous observers', async () => {
    const root = await rootWithSpaces()
    const syncLease = await coordinator(root, 'sync-observer', DEFAULT_ACQUISITION_TIMEOUT_MS, () => {
      throw new Error('SYNC_OBSERVER_FAILURE')
    }).acquire('dedicated')
    await syncLease.release()

    let rejectObserver: (reason: Error) => void = () => undefined
    const pendingObserver = new Promise<void>((_resolve, reject) => {
      rejectObserver = reject
    })
    const asyncLease = await settlesWithin(coordinator(
      root,
      'async-observer',
      DEFAULT_ACQUISITION_TIMEOUT_MS,
      () => pendingObserver,
    ).acquire('dedicated'))
    await asyncLease.release()
    rejectObserver(new Error('ASYNC_OBSERVER_FAILURE'))
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 0))
  })

  it('recognizes a child that already exited by signal without waiting for another exit', async () => {
    const once = vi.fn(() => {
      throw new Error('UNEXPECTED_CHILD_OPERATION')
    })
    const end = vi.fn()
    const kill = vi.fn()
    const child = {
      exitCode: null,
      signalCode: 'SIGTERM',
      once,
      kill,
      stdin: { end },
    } as unknown as ChildProcessWithoutNullStreams

    await expect(releaseChild(child)).rejects.toThrow('CHILD_SIGNAL_SIGTERM')
    expect(once).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it('coordinates isolated worker processes under one run token', { timeout: PROCESS_TEST_TIMEOUT_MS }, async () => {
    const root = await rootWithSpaces()
    let suiteWorker: ChildProcessWithoutNullStreams | undefined
    let dedicatedWorker: ChildProcessWithoutNullStreams | undefined
    let third: Promise<BranchLease> | undefined
    let admitted: BranchLease | undefined
    let primary: unknown
    let hasPrimary = false
    try {
      suiteWorker = await childLease(root, 'suite')
      dedicatedWorker = await childLease(root, 'dedicated')
      const thirdRegistration = waiterRegistration()
      third = coordinator(
        root,
        'child-run',
        DEFAULT_ACQUISITION_TIMEOUT_MS,
        thirdRegistration.notify,
      ).acquire('dedicated')
      await settlesWithin(thirdRegistration.observed)
      await remainsPending(third)
      await releaseChild(dedicatedWorker)
      dedicatedWorker = undefined
      admitted = await settlesWithin(third)
    } catch (error) {
      primary = error
      hasPrimary = true
    } finally {
      const cleanupFailures: unknown[] = []
      const attempt = async (operation: () => Promise<void>): Promise<void> => {
        try {
          await operation()
        } catch (error) {
          cleanupFailures.push(error)
        }
      }
      if (dedicatedWorker) {
        const child = dedicatedWorker
        dedicatedWorker = undefined
        await attempt(() => releaseChild(child))
      }
      if (admitted) await attempt(() => admitted!.release())
      else if (third) {
        await attempt(async () => {
          await (await settlesWithin(third!)).release()
        })
      }
      if (suiteWorker) await attempt(() => releaseChild(suiteWorker!))
      if (hasPrimary && cleanupFailures.length > 0) {
        throw new AggregateError([primary, ...cleanupFailures], 'BRANCH_LEASE_TEST_AND_CLEANUP_FAILED')
      }
      if (hasPrimary) throw primary
      if (cleanupFailures.length === 1) throw cleanupFailures[0]
      if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, 'BRANCH_LEASE_TEST_CLEANUP_FAILED')
    }
  })

  it('admits one suite plus one dedicated lease and makes a third wait', async () => {
    const root = await rootWithSpaces()
    const suite = await coordinator(root).acquire('suite')
    const dedicated = await coordinator(root).acquire('dedicated')
    const third = coordinator(root).acquire('dedicated')
    await remainsPending(third)
    await dedicated.release()
    const admitted = await settlesWithin(third)
    await admitted.release()
    await suite.release()
  })

  it('never allows two suite leases to coexist', async () => {
    const root = await rootWithSpaces()
    const suite = await coordinator(root).acquire('suite')
    const second = coordinator(root).acquire('suite')
    await remainsPending(second)
    await suite.release()
    await (await settlesWithin(second)).release()
  })

  it('allows two dedicated leases to coexist', async () => {
    const root = await rootWithSpaces()
    const [first, second] = await Promise.all([
      coordinator(root).acquire('dedicated'),
      coordinator(root).acquire('dedicated'),
    ])
    expect(first.id).not.toBe(second.id)
    expect([first.kind, second.kind]).toEqual(['dedicated', 'dedicated'])
    await Promise.all([first.release(), second.release()])
  })

  it('observes acquisition and cleanup budgets before the default test observer times out', async () => {
    const runtimePhaseBudgetMs = DEFAULT_ACQUISITION_TIMEOUT_MS + WAITER_CLEANUP_OPPORTUNITY_MS
    vi.useFakeTimers()
    try {
      const observed = settlesWithin(new Promise<never>(() => undefined))
        .then(() => 'SETTLED', (error: Error) => error.message)
      await vi.advanceTimersByTimeAsync(runtimePhaseBudgetMs)
      const pending = Symbol('pending')
      await expect(Promise.race([observed, Promise.resolve(pending)])).resolves.toBe(pending)
      await vi.advanceTimersByTimeAsync(DEFAULT_SETTLE_TIMEOUT_MS - runtimePhaseBudgetMs)
      await expect(observed).resolves.toBe('TEST_TIMEOUT')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prunes a persisted expired waiter before admitting the live FIFO head', async () => {
    const root = await rootWithSpaces()
    const runTokenHash = createHash('sha256').update('run-a').digest('hex')
    const runDir = join(root, runTokenHash)
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'state.json'), `${JSON.stringify({
      version: 1,
      runTokenHash,
      nextSequence: 1,
      active: [],
      suiteWaiters: [],
      dedicatedWaiters: [{
        id: 'crashed-waiter', ownerId: 'dead-worker', kind: 'dedicated', sequence: 0, expiresAt: Date.now() - 1,
      }],
    })}\n`, 'utf8')

    const lease = await settlesWithin(coordinator(root).acquire('dedicated'))
    expect(lease.kind).toBe('dedicated')
    const persisted = JSON.parse(await readFile(join(runDir, 'state.json'), 'utf8')) as {
      active: Array<{ id: string }>
      dedicatedWaiters: Array<{ id: string }>
    }
    expect(persisted.dedicatedWaiters).toEqual([])
    expect(persisted.active.map(({ id }) => id)).toEqual([lease.id])
    await lease.release()
  })

  it.each<BranchLeaseKind>(['suite', 'dedicated'])('preserves FIFO order within the %s class', async (kind) => {
    const root = await rootWithSpaces()
    const blocker = kind === 'suite'
      ? await coordinator(root).acquire('suite')
      : await Promise.all([coordinator(root).acquire('dedicated'), coordinator(root).acquire('dedicated')])
    const arrivals: number[] = []
    const firstRegistration = waiterRegistration()
    const first = coordinator(root, 'run-a', DEFAULT_ACQUISITION_TIMEOUT_MS, firstRegistration.notify)
      .acquire(kind).then((lease) => { arrivals.push(1); return lease })
    await settlesWithin(firstRegistration.observed)
    const secondRegistration = waiterRegistration()
    const second = coordinator(root, 'run-a', DEFAULT_ACQUISITION_TIMEOUT_MS, secondRegistration.notify)
      .acquire(kind).then((lease) => { arrivals.push(2); return lease })
    await settlesWithin(secondRegistration.observed)
    await remainsPending(first)

    if (Array.isArray(blocker)) await blocker[0].release()
    else await blocker.release()
    const firstLease = await settlesWithin(first)
    expect(arrivals).toEqual([1])
    if (kind === 'suite') await remainsPending(second)
    await firstLease.release()
    const secondLease = await settlesWithin(second)
    expect(arrivals).toEqual([1, 2])
    await secondLease.release()
    if (Array.isArray(blocker)) await blocker[1].release()
  })

  it('does not let a waiting suite block the active suite from dedicated capacity', async () => {
    const root = await rootWithSpaces()
    const activeSuite = await coordinator(root).acquire('suite')
    const registration = waiterRegistration()
    const waitingSuite = coordinator(root, 'run-a', DEFAULT_ACQUISITION_TIMEOUT_MS, registration.notify)
      .acquire('suite')
    await settlesWithin(registration.observed)
    await remainsPending(waitingSuite)
    const dedicated = await settlesWithin(coordinator(root).acquire('dedicated'))
    await dedicated.release()
    await activeSuite.release()
    await (await settlesWithin(waitingSuite)).release()
  })

  it('removes a timed-out waiter without disturbing active capacity', async () => {
    const root = await rootWithSpaces()
    const active = await Promise.all([
      coordinator(root).acquire('dedicated'),
      coordinator(root).acquire('dedicated'),
    ])
    await expect(coordinator(root, 'run-a', 40).acquire('dedicated')).rejects.toEqual(
      new BranchLeaseError('DB_CONTRACT_BRANCH_LEASE_ACQUISITION_TIMEOUT'),
    )
    await active[0].release()
    const replacement = await settlesWithin(coordinator(root).acquire('dedicated'))
    await replacement.release()
    await active[1].release()
  })

  it('admits a queued phase when capacity returns within the scaled acquisition budget', async () => {
    const root = await rootWithSpaces()
    const acquisitionTimeoutMs = 1_000
    const active = await coordinator(root, 'run-a', acquisitionTimeoutMs).acquire('suite')
    const registration = waiterRegistration()
    const queued = coordinator(root, 'run-a', acquisitionTimeoutMs, registration.notify).acquire('suite')
    await settlesWithin(registration.observed)
    await remainsPending(queued, 40)
    await active.release()
    const admitted = await settlesWithin(
      queued,
      acquisitionTimeoutMs + WAITER_CLEANUP_OPPORTUNITY_MS + OBSERVER_MARGIN_MS,
    )
    expect(admitted.kind).toBe('suite')
    await admitted.release()
  })

  it('retains capacity when deletion is uncertain because the lease is not released', async () => {
    const root = await rootWithSpaces()
    const retained = await coordinator(root).acquire('suite')
    await expect(coordinator(root, 'run-a', 40).acquire('suite')).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_LEASE_ACQUISITION_TIMEOUT',
    })
    await retained.release()
    await (await settlesWithin(coordinator(root).acquire('suite'))).release()
  })

  it('isolates capacity by run token', async () => {
    const root = await rootWithSpaces()
    const runA = await Promise.all([
      coordinator(root, 'run-a').acquire('dedicated'),
      coordinator(root, 'run-a').acquire('dedicated'),
    ])
    const runB = await settlesWithin(coordinator(root, 'run-b').acquire('suite'))
    expect(runA.map(({ kind }) => kind)).toEqual(['dedicated', 'dedicated'])
    expect(runB.kind).toBe('suite')
    const runAState = JSON.parse(await readFile(join(
      root, createHash('sha256').update('run-a').digest('hex'), 'state.json',
    ), 'utf8')) as { active: Array<{ id: string }> }
    const runBState = JSON.parse(await readFile(join(
      root, createHash('sha256').update('run-b').digest('hex'), 'state.json',
    ), 'utf8')) as { active: Array<{ id: string }> }
    expect(runAState.active.map(({ id }) => id).sort()).toEqual(runA.map(({ id }) => id).sort())
    expect(runBState.active.map(({ id }) => id)).toEqual([runB.id])
    await Promise.all([...runA.map((lease) => lease.release()), runB.release()])
  })

  it('does not free capacity on ownership mismatch', async () => {
    const root = await rootWithSpaces()
    const lease = await coordinator(root).acquire('suite')
    const forged = { ...lease, ownerId: 'forged-owner' } as BranchLease
    await expect(coordinator(root).release(forged)).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_LEASE_OWNERSHIP_MISMATCH',
    })
    const waiting = coordinator(root).acquire('suite')
    await remainsPending(waiting)
    await lease.release()
    await (await settlesWithin(waiting)).release()
  })

  it('fails closed on corrupt state instead of resetting capacity', async () => {
    const root = await rootWithSpaces()
    const runDir = join(root, createHash('sha256').update('run-a').digest('hex'))
    await mkdir(runDir, { recursive: true })
    await writeFile(join(runDir, 'state.json'), '{not-json', 'utf8')
    await expect(coordinator(root).acquire('dedicated')).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_LEASE_STATE_UNCERTAIN',
    })
  })

  it('fails closed on a stale or abandoned lock', async () => {
    const root = await rootWithSpaces()
    const initialized = await coordinator(root).acquire('dedicated')
    await initialized.release()
    const runDir = join(root, createHash('sha256').update('run-a').digest('hex'))
    await mkdir(join(runDir, '.lock'))
    await expect(coordinator(root, 'run-a', 40).acquire('dedicated')).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_LEASE_LOCK_UNCERTAIN',
    })
  })
})
