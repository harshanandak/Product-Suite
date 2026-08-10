import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export type BranchLeaseKind = 'suite' | 'dedicated'

export class BranchLeaseError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'BranchLeaseError'
    this.code = code
  }
}

export interface BranchLease {
  readonly id: string
  readonly ownerId: string
  readonly kind: BranchLeaseKind
  release(): Promise<void>
}

interface LeaseRecord {
  id: string
  ownerId: string
  kind: BranchLeaseKind
}

interface WaiterRecord extends LeaseRecord {
  sequence: number
  expiresAt: number
}

interface LeaseState {
  version: 1
  runTokenHash: string
  nextSequence: number
  active: LeaseRecord[]
  suiteWaiters: WaiterRecord[]
  dedicatedWaiters: WaiterRecord[]
}

export interface BranchLeaseCoordinatorOptions {
  runToken: string
  rootDir?: string
  acquisitionTimeoutMs?: number
  pollIntervalMs?: number
  ownerId?: string
}

export interface BranchLeaseCoordinator {
  acquire(kind: BranchLeaseKind): Promise<BranchLease>
  release(lease: Pick<BranchLease, 'id' | 'ownerId' | 'kind'>): Promise<void>
}

const DEFAULT_ROOT = join(tmpdir(), 'product-suite-db-contract-branch-leases')
const DEFAULT_ACQUISITION_TIMEOUT_MS = 300_000
const DEFAULT_POLL_INTERVAL_MS = 50

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')

function stable(code: string): BranchLeaseError {
  return new BranchLeaseError(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validLease(value: unknown): value is LeaseRecord {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && typeof value.ownerId === 'string' && value.ownerId.length > 0
    && (value.kind === 'suite' || value.kind === 'dedicated')
}

function validWaiter(value: unknown): value is WaiterRecord {
  const record = value as unknown as Record<string, unknown>
  return validLease(value) && Number.isSafeInteger(record.sequence)
    && Number(record.sequence) >= 0 && Number.isFinite(record.expiresAt)
}

function queueFor(state: LeaseState, kind: BranchLeaseKind): WaiterRecord[] {
  return kind === 'suite' ? state.suiteWaiters : state.dedicatedWaiters
}

function pruneExpiredWaiters(state: LeaseState, now: number): void {
  state.suiteWaiters = state.suiteWaiters.filter(({ expiresAt }) => expiresAt > now)
  state.dedicatedWaiters = state.dedicatedWaiters.filter(({ expiresAt }) => expiresAt > now)
}

function validateState(value: unknown, expectedHash: string): LeaseState {
  if (!isRecord(value) || value.version !== 1 || value.runTokenHash !== expectedHash
    || !Number.isSafeInteger(value.nextSequence) || Number(value.nextSequence) < 0
    || !Array.isArray(value.active) || !value.active.every(validLease)
    || !Array.isArray(value.suiteWaiters) || !value.suiteWaiters.every(validWaiter)
    || !Array.isArray(value.dedicatedWaiters) || !value.dedicatedWaiters.every(validWaiter)) {
    throw stable('DB_CONTRACT_BRANCH_LEASE_STATE_UNCERTAIN')
  }
  const state = value as unknown as LeaseState
  const ids = [...state.active, ...state.suiteWaiters, ...state.dedicatedWaiters].map(({ id }) => id)
  const suiteCount = state.active.filter(({ kind }) => kind === 'suite').length
  if (new Set(ids).size !== ids.length || state.active.length > 2 || suiteCount > 1
    || state.suiteWaiters.some(({ kind }) => kind !== 'suite')
    || state.dedicatedWaiters.some(({ kind }) => kind !== 'dedicated')) {
    throw stable('DB_CONTRACT_BRANCH_LEASE_STATE_UNCERTAIN')
  }
  return state
}

export function createBranchLeaseCoordinator(options: BranchLeaseCoordinatorOptions): BranchLeaseCoordinator {
  if (!options.runToken || !Number.isFinite(options.acquisitionTimeoutMs ?? DEFAULT_ACQUISITION_TIMEOUT_MS)
    || (options.acquisitionTimeoutMs ?? DEFAULT_ACQUISITION_TIMEOUT_MS) <= 0
    || !Number.isFinite(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    || (options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS) <= 0) {
    throw stable('DB_CONTRACT_BRANCH_LEASE_CONFIG_INVALID')
  }
  const runTokenHash = tokenHash(options.runToken)
  const runDir = join(options.rootDir ?? DEFAULT_ROOT, runTokenHash)
  const statePath = join(runDir, 'state.json')
  const lockPath = join(runDir, '.lock')
  const ownerId = options.ownerId ?? `${process.pid}-${randomBytes(12).toString('hex')}`
  const acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? DEFAULT_ACQUISITION_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  async function withLock<T>(deadline: number, operation: (state: LeaseState) => Promise<T> | T): Promise<T> {
    await mkdir(runDir, { recursive: true })
    while (true) {
      try {
        await mkdir(lockPath)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw stable('DB_CONTRACT_BRANCH_LEASE_LOCK_UNCERTAIN')
        }
        if (Date.now() >= deadline) throw stable('DB_CONTRACT_BRANCH_LEASE_LOCK_UNCERTAIN')
        await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
      }
    }

    let result: T | undefined
    let primary: unknown
    let hasPrimary = false
    try {
      let state: LeaseState
      try {
        const raw = await readFile(statePath, 'utf8')
        state = validateState(JSON.parse(raw), runTokenHash)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          state = {
            version: 1,
            runTokenHash,
            nextSequence: 0,
            active: [],
            suiteWaiters: [],
            dedicatedWaiters: [],
          }
        } else if (error instanceof BranchLeaseError) {
          throw error
        } else {
          throw stable('DB_CONTRACT_BRANCH_LEASE_STATE_UNCERTAIN')
        }
      }
      result = await operation(state)
      const temporary = join(dirname(statePath), `.state-${process.pid}-${randomBytes(6).toString('hex')}.tmp`)
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx' })
      try {
        await rename(temporary, statePath)
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw stable('DB_CONTRACT_BRANCH_LEASE_STATE_UNCERTAIN')
      }
    } catch (error) {
      primary = error
      hasPrimary = true
    }
    let cleanup: BranchLeaseError | undefined
    try {
      await rmdir(lockPath)
    } catch {
      cleanup = stable('DB_CONTRACT_BRANCH_LEASE_LOCK_UNCERTAIN')
    }
    if (hasPrimary && cleanup) throw new AggregateError([primary, cleanup], 'DB_CONTRACT_BRANCH_LEASE_AND_CLEANUP_FAILED')
    if (hasPrimary) throw primary
    if (cleanup) throw cleanup
    return result as T
  }

  async function removeWaiter(id: string): Promise<void> {
    await withLock(Date.now() + 1_000, (state) => {
      state.suiteWaiters = state.suiteWaiters.filter((waiter) => waiter.id !== id)
      state.dedicatedWaiters = state.dedicatedWaiters.filter((waiter) => waiter.id !== id)
    })
  }

  const coordinator: BranchLeaseCoordinator = {
    async acquire(kind) {
      if (kind !== 'suite' && kind !== 'dedicated') throw stable('DB_CONTRACT_BRANCH_LEASE_KIND_INVALID')
      const id = randomBytes(16).toString('hex')
      const deadline = Date.now() + acquisitionTimeoutMs
      await withLock(deadline, (state) => {
        const waiter: WaiterRecord = { id, ownerId, kind, sequence: state.nextSequence, expiresAt: deadline }
        state.nextSequence += 1
        queueFor(state, kind).push(waiter)
      })

      while (Date.now() < deadline) {
        const admitted = await withLock(deadline, (state) => {
          pruneExpiredWaiters(state, Date.now())
          const waiters = queueFor(state, kind)
          const index = waiters.findIndex((waiter) => waiter.id === id && waiter.ownerId === ownerId)
          if (index < 0) return 'expired' as const
          const suiteActive = state.active.some((lease) => lease.kind === 'suite')
          const eligible = index === 0 && state.active.length < 2 && (kind === 'dedicated' || !suiteActive)
          if (!eligible) return false
          waiters.splice(index, 1)
          state.active.push({ id, ownerId, kind })
          return true
        })
        if (admitted === 'expired') {
          break
        }
        if (admitted) {
          const lease: BranchLease = {
            id,
            ownerId,
            kind,
            release: () => coordinator.release(lease),
          }
          return lease
        }
        await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
      }
      try {
        await removeWaiter(id)
      } catch {
        throw stable('DB_CONTRACT_BRANCH_LEASE_WAITER_CLEANUP_UNPROVEN')
      }
      throw stable('DB_CONTRACT_BRANCH_LEASE_ACQUISITION_TIMEOUT')
    },

    async release(lease) {
      await withLock(Date.now() + acquisitionTimeoutMs, (state) => {
        const index = state.active.findIndex(({ id }) => id === lease.id)
        const current = state.active[index]
        if (!current || current.ownerId !== lease.ownerId || current.kind !== lease.kind || lease.ownerId !== ownerId) {
          throw stable('DB_CONTRACT_BRANCH_LEASE_OWNERSHIP_MISMATCH')
        }
        state.active.splice(index, 1)
      })
    },
  }
  return coordinator
}
