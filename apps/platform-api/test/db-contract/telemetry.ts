import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

import { DB_CONTRACT_SUITE_CONCURRENCY, workerRuntimeConfig } from './runtime-config'
import { EXPECTED_TOTAL_ASSERTIONS, SUITE_IDS, TOPOLOGY_VERSION } from './topology'

export const TELEMETRY_SCHEMA_VERSION = 1 as const

export const TELEMETRY_PHASES = [
  'credential',
  'reap',
  'create',
  'prepare',
  'seed',
  'test',
  'rollback',
  'observer',
  'delete',
  'finalCleanup',
] as const

export type TelemetryPhase = (typeof TELEMETRY_PHASES)[number]

interface PhaseEvidence {
  count: number
  durationMs: number
}

export interface TelemetryCounts {
  collected: number
  passed: number
  skipped: number
  todo: number
  pending: number
  filtered: number
  unclassified: number
  zeroSkip: boolean
}

export interface DbContractTelemetry {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION
  exactHead: string
  topologyVersion: typeof TOPOLOGY_VERSION
  suiteFiles: number
  expectedTests: number
  counts: TelemetryCounts | null
  phases: Partial<Record<TelemetryPhase, PhaseEvidence>>
  cleanup: {
    complete: boolean
    proof: 'not-proven' | 'current-run-absent'
  }
  branchCapacity: { configured: number; available: number } | null
  rateLimit: { result: 'stable' | 'unknown'; stableCount: number | null }
  concurrency: number
}

const TOP_LEVEL_KEYS = [
  'schemaVersion', 'exactHead', 'topologyVersion', 'suiteFiles', 'expectedTests',
  'counts', 'phases', 'cleanup', 'branchCapacity', 'rateLimit', 'concurrency',
] as const
const COUNT_KEYS = ['collected', 'passed', 'skipped', 'todo', 'pending', 'filtered', 'unclassified', 'zeroSkip'] as const

export class TelemetryError extends Error {
  constructor(code: string) {
    super(code)
    this.name = 'TelemetryError'
  }
}

function fail(code = 'DB_CONTRACT_TELEMETRY_INVALID'): never {
  throw new TelemetryError(code)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right))
  const expected = [...keys].sort((left, right) => left.localeCompare(right))
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

const isSafeInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum

function assertTelemetryHeader(record: Record<string, unknown>): void {
  if (record.schemaVersion !== TELEMETRY_SCHEMA_VERSION || record.topologyVersion !== TOPOLOGY_VERSION) fail()
  if (typeof record.exactHead !== 'string' || !/^[0-9a-f]{40}$/i.test(record.exactHead)) fail()
  if (!isSafeInteger(record.suiteFiles, 1) || !isSafeInteger(record.expectedTests, 1)) fail()
  if (!isSafeInteger(record.concurrency, 1) || record.concurrency > DB_CONTRACT_SUITE_CONCURRENCY) fail()
}

function assertTelemetryCounts(value: unknown): void {
  if (value === null) return
  if (!isObject(value) || !hasExactKeys(value, COUNT_KEYS)) fail()
  for (const key of COUNT_KEYS.slice(0, -1)) {
    if (!isSafeInteger(value[key])) fail()
  }
  if (typeof value.zeroSkip !== 'boolean') fail()
}

function assertTelemetryPhases(value: unknown): void {
  if (!isObject(value)) fail()
  for (const [phase, evidenceValue] of Object.entries(value)) {
    if (!(TELEMETRY_PHASES as readonly string[]).includes(phase)) fail()
    if (!isObject(evidenceValue) || !hasExactKeys(evidenceValue, ['count', 'durationMs'])) fail()
    if (!isSafeInteger(evidenceValue.count, 1) || !isSafeInteger(evidenceValue.durationMs)) fail()
  }
}

function assertTelemetryCleanup(value: unknown): void {
  if (!isObject(value) || !hasExactKeys(value, ['complete', 'proof'])) fail()
  if (typeof value.complete !== 'boolean') fail()
  if (value.proof !== 'not-proven' && value.proof !== 'current-run-absent') fail()
  if (value.complete !== (value.proof === 'current-run-absent')) fail()
}

function assertTelemetryCapacity(value: unknown): void {
  if (value === null) return
  if (!isObject(value) || !hasExactKeys(value, ['configured', 'available'])) fail()
  if (!isSafeInteger(value.configured, 1) || !isSafeInteger(value.available)) fail()
  if (value.available > value.configured) fail()
}

function assertTelemetryRateLimit(value: unknown): void {
  if (!isObject(value) || !hasExactKeys(value, ['result', 'stableCount'])) fail()
  if (value.result !== 'stable' && value.result !== 'unknown') fail()
  if (value.stableCount !== null && !isSafeInteger(value.stableCount)) fail()
  if (value.result === 'unknown' && value.stableCount !== null) fail()
}

function assertTelemetry(value: unknown): asserts value is DbContractTelemetry {
  if (!isObject(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) fail()
  assertTelemetryHeader(value)
  assertTelemetryCounts(value.counts)
  assertTelemetryPhases(value.phases)
  assertTelemetryCleanup(value.cleanup)
  assertTelemetryCapacity(value.branchCapacity)
  assertTelemetryRateLimit(value.rateLimit)
}

export const telemetryPathFromEnv = (): string => workerRuntimeConfig().telemetryPath

function writeTelemetry(path: string, telemetry: DbContractTelemetry): void {
  assertTelemetry(telemetry)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(telemetry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

const lockWait = new Int32Array(new SharedArrayBuffer(4))

function withLedgerLock<T>(path: string, operation: () => T): T {
  const lockPath = `${path}.lock`
  mkdirSync(dirname(path), { recursive: true })
  let descriptor: number | undefined
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fail()
      Atomics.wait(lockWait, 0, 0, 10)
    }
  }
  if (descriptor === undefined) fail('DB_CONTRACT_TELEMETRY_LOCK_UNAVAILABLE')
  const lockedDescriptor = descriptor
  try {
    return operation()
  } finally {
    closeSync(lockedDescriptor)
    unlinkSync(lockPath)
  }
}

export function initializeTelemetry(
  path: string,
  input: { exactHead: string; concurrency: number },
): DbContractTelemetry {
  const telemetry: DbContractTelemetry = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    exactHead: input.exactHead,
    topologyVersion: TOPOLOGY_VERSION,
    suiteFiles: Object.keys(SUITE_IDS).length,
    expectedTests: EXPECTED_TOTAL_ASSERTIONS,
    counts: null,
    phases: {},
    cleanup: { complete: false, proof: 'not-proven' },
    branchCapacity: null,
    rateLimit: { result: 'unknown', stableCount: null },
    concurrency: input.concurrency,
  }
  writeTelemetry(path, telemetry)
  return telemetry
}

export function readTelemetry(path: string): DbContractTelemetry {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail()
  }
  assertTelemetry(value)
  return value
}

function updateTelemetry(path: string, update: (current: DbContractTelemetry) => void): DbContractTelemetry {
  return withLedgerLock(path, () => {
    const current = readTelemetry(path)
    update(current)
    writeTelemetry(path, current)
    return current
  })
}

export function recordPhaseDuration(path: string, phase: TelemetryPhase, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) fail()
  const rounded = Math.round(durationMs)
  updateTelemetry(path, (current) => {
    const previous = current.phases[phase] ?? { count: 0, durationMs: 0 }
    current.phases[phase] = { count: previous.count + 1, durationMs: previous.durationMs + rounded }
  })
}

export async function measurePhase<T>(path: string, phase: TelemetryPhase, operation: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    return await operation()
  } finally {
    recordPhaseDuration(path, phase, performance.now() - started)
  }
}

export function recordCounts(path: string, counts: Omit<TelemetryCounts, 'zeroSkip'>): void {
  const zeroSkip = counts.skipped === 0 && counts.todo === 0 && counts.pending === 0
    && counts.filtered === 0 && counts.unclassified === 0
  updateTelemetry(path, (current) => {
    current.counts = { ...counts, zeroSkip }
  })
}

export function recordBranchCapacity(
  path: string,
  capacity: { configured: number; available: number },
): void {
  updateTelemetry(path, (current) => {
    current.branchCapacity = capacity
  })
}

export function recordCleanupComplete(path: string): void {
  updateTelemetry(path, (current) => {
    current.cleanup = { complete: true, proof: 'current-run-absent' }
  })
}

export function finalizeTelemetry(path: string): DbContractTelemetry {
  const telemetry = readTelemetry(path)
  if (telemetry.counts?.collected !== EXPECTED_TOTAL_ASSERTIONS
    || telemetry.counts?.passed !== EXPECTED_TOTAL_ASSERTIONS || !telemetry.counts?.zeroSkip) {
    fail('DB_CONTRACT_TELEMETRY_COUNTS_INCOMPLETE')
  }
  if (!telemetry.branchCapacity) fail('DB_CONTRACT_TELEMETRY_CAPACITY_INCOMPLETE')
  if (!telemetry.cleanup.complete) fail('DB_CONTRACT_TELEMETRY_CLEANUP_INCOMPLETE')
  return telemetry
}

export function publishTelemetrySummary(path: string, summaryPath: string): void {
  const telemetry = finalizeTelemetry(path)
  const phaseRows = TELEMETRY_PHASES
    .filter((phase) => telemetry.phases[phase])
    .map((phase) => `| ${phase} | ${telemetry.phases[phase]?.count ?? 0} | ${telemetry.phases[phase]?.durationMs ?? 0} |`)
    .join('\n')
  const summary = [
    '## DB Contract evidence',
    '',
    `- Exact head: \`${telemetry.exactHead}\``,
    `- Topology: \`${telemetry.topologyVersion}\` (${telemetry.suiteFiles} files / ${telemetry.counts?.collected ?? 0} tests)`,
    `- Zero skip: **${telemetry.counts?.zeroSkip === true ? 'complete' : 'incomplete'}**`,
    `- Cleanup: **${telemetry.cleanup.complete ? 'complete' : 'incomplete'}**`,
    `- Branch capacity: ${telemetry.branchCapacity?.available ?? 0}/${telemetry.branchCapacity?.configured ?? 0} available`,
    `- Rate limit: ${telemetry.rateLimit.result}`,
    `- Concurrency: ${telemetry.concurrency}`,
    '',
    '| Phase | Count | Duration (ms) |',
    '| --- | ---: | ---: |',
    phaseRows,
    '',
  ].join('\n')
  appendFileSync(summaryPath, summary, 'utf8')
}

if (import.meta.main) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (process.argv[2] !== 'summary' || !summaryPath) fail()
  publishTelemetrySummary(telemetryPathFromEnv(), summaryPath)
}
