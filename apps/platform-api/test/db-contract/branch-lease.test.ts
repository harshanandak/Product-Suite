import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  BranchLeaseError,
  createBranchLeaseCoordinator,
  type BranchLease,
  type BranchLeaseKind,
} from './branch-lease'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function rootWithSpaces(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'db contract leases '))
  roots.push(root)
  return root
}

function coordinator(rootDir: string, runToken = 'run-a', timeout = 1_000) {
  return createBranchLeaseCoordinator({
    rootDir,
    runToken,
    acquisitionTimeoutMs: timeout,
    pollIntervalMs: 5,
  })
}

async function settlesWithin<T>(promise: Promise<T>, timeoutMs = 500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TEST_TIMEOUT')), timeoutMs)),
  ])
}

async function remainsPending(promise: Promise<unknown>, durationMs = 50): Promise<void> {
  const marker = Symbol('pending')
  await expect(Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(marker), durationMs))]))
    .resolves.toBe(marker)
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
  await new Promise<void>((resolveReady, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('CHILD_READY_TIMEOUT')), 2_000)
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('ACQUIRED')) {
        clearTimeout(timer)
        resolveReady()
      }
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (!output.includes('ACQUIRED')) reject(new Error(`CHILD_EXIT_${String(code)}`))
    })
  })
  return child
}

async function releaseChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.stdin.end('release\n')
  await new Promise<void>((resolveExit, reject) => {
    child.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error(`CHILD_EXIT_${String(code)}`)))
  })
}

describe('run-wide branch lease coordinator', () => {
  it('coordinates isolated worker processes under one run token', async () => {
    const root = await rootWithSpaces()
    const suiteWorker = await childLease(root, 'suite')
    const dedicatedWorker = await childLease(root, 'dedicated')
    const third = createBranchLeaseCoordinator({
      rootDir: root,
      runToken: 'child-run',
      acquisitionTimeoutMs: 2_000,
      pollIntervalMs: 5,
    }).acquire('dedicated')
    await remainsPending(third)
    await releaseChild(dedicatedWorker)
    const admitted = await settlesWithin(third, 1_000)
    await admitted.release()
    await releaseChild(suiteWorker)
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
    await Promise.all([first.release(), second.release()])
  })

  it.each<BranchLeaseKind>(['suite', 'dedicated'])('preserves FIFO order within the %s class', async (kind) => {
    const root = await rootWithSpaces()
    const blocker = kind === 'suite'
      ? await coordinator(root).acquire('suite')
      : await Promise.all([coordinator(root).acquire('dedicated'), coordinator(root).acquire('dedicated')])
    const arrivals: number[] = []
    const first = coordinator(root).acquire(kind).then((lease) => { arrivals.push(1); return lease })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = coordinator(root).acquire(kind).then((lease) => { arrivals.push(2); return lease })
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
    const waitingSuite = coordinator(root).acquire('suite')
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

  it('retains capacity when deletion is uncertain because the lease is not released', async () => {
    const root = await rootWithSpaces()
    const retained = await coordinator(root).acquire('suite')
    const secondSuite = coordinator(root).acquire('suite')
    await remainsPending(secondSuite)
    await expect(coordinator(root, 'run-a', 40).acquire('suite')).rejects.toMatchObject({
      code: 'DB_CONTRACT_BRANCH_LEASE_ACQUISITION_TIMEOUT',
    })
    await retained.release()
    await (await settlesWithin(secondSuite)).release()
  })

  it('isolates capacity by run token', async () => {
    const root = await rootWithSpaces()
    const runA = await Promise.all([
      coordinator(root, 'run-a').acquire('dedicated'),
      coordinator(root, 'run-a').acquire('dedicated'),
    ])
    const runB = await settlesWithin(coordinator(root, 'run-b').acquire('suite'))
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
