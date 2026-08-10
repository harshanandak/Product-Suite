import { classifyTestId, EXPECTED_TOTAL_ASSERTIONS, resolveTestId, SUITE_MANIFEST } from './topology'
import { recordCounts, recordPhaseDuration, telemetryPathFromEnv } from './telemetry'

export const DB_CONTRACT_ZERO_TESTS = 'DB_CONTRACT_ZERO_TESTS' as const
export const DB_CONTRACT_SKIPPED = 'DB_CONTRACT_SKIPPED' as const
export const DB_CONTRACT_UNCLASSIFIED = 'DB_CONTRACT_UNCLASSIFIED' as const
export const DB_CONTRACT_TOPOLOGY_MISMATCH = 'DB_CONTRACT_TOPOLOGY_MISMATCH' as const
export const DB_CONTRACT_METADATA = 'DB_CONTRACT_METADATA_MISSING' as const
export const DB_CONTRACT_INCOMPLETE_CLEANUP = 'DB_CONTRACT_INCOMPLETE_CLEANUP' as const

export type DbContractFailureCode =
  | typeof DB_CONTRACT_ZERO_TESTS
  | typeof DB_CONTRACT_SKIPPED
  | typeof DB_CONTRACT_UNCLASSIFIED
  | typeof DB_CONTRACT_TOPOLOGY_MISMATCH
  | typeof DB_CONTRACT_METADATA
  | typeof DB_CONTRACT_INCOMPLETE_CLEANUP

/**
 * Evidence accepted by the reporter. Counts may be supplied by Vitest adapters
 * as numbers or arrays; arrays are counted without logging their contents.
 */
export interface DbContractEvidence {
  collected: number
  passed?: number
  skipped: number
  todo: number
  pending: number
  filtered: number
  unclassified: readonly string[]
  /** Every resolved manifest id, retained so duplicate/missing tests fail closed. */
  manifestIds: readonly string[]
  exactHead?: string | null
  cleanupComplete: boolean
  /** Optional explicit expected count for callers that want to self-describe. */
  expectedCount?: number
  /** Optional equality check when the runner knows its expected exact SHA. */
  expectedExactHead?: string | null
}

export interface ValidatedDbContractEvidence {
  readonly collected: number
  readonly passed: number
  readonly skipped: number
  readonly todo: number
  readonly pending: number
  readonly filtered: number
  readonly cleanupComplete: true
}

/** Stable error whose message never includes titles, paths, URLs, or secrets. */
export class DbContractEvidenceError extends Error {
  readonly code: DbContractFailureCode

  constructor(code: DbContractFailureCode) {
    super(`${code}: DB Contract evidence rejected`)
    this.name = 'DbContractEvidenceError'
    this.code = code
  }
}

const count = (value: number | readonly unknown[] | undefined): number => {
  if (Array.isArray(value)) return value.length
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const fail = (code: DbContractFailureCode): never => {
  throw new DbContractEvidenceError(code)
}

/**
 * Validate a completed DB Contract run. Validation order is deliberate: zero
 * collected is reported before the generic count mismatch, giving automation a
 * stable diagnosis while still failing closed.
 */
export function assertDbContractEvidence(evidence: DbContractEvidence): ValidatedDbContractEvidence {
  const validated = assertDbContractPreliminaryEvidence(evidence)
  if (evidence.cleanupComplete !== true) fail(DB_CONTRACT_INCOMPLETE_CLEANUP)
  return { ...validated, cleanupComplete: true }
}

export function assertDbContractPreliminaryEvidence(
  evidence: DbContractEvidence,
): Omit<ValidatedDbContractEvidence, 'cleanupComplete'> {
  const collected = count(evidence.collected)
  const skipped = count(evidence.skipped)
  const todo = count(evidence.todo)
  const pending = count(evidence.pending)
  const filtered = count(evidence.filtered)
  const passed = count(evidence.passed)
  const manifestIds = Array.isArray(evidence.manifestIds) ? evidence.manifestIds : []

  if (collected === 0) fail(DB_CONTRACT_ZERO_TESTS)
  if (evidence.unclassified.length > 0) fail(DB_CONTRACT_UNCLASSIFIED)
  if (skipped > 0 || todo > 0 || pending > 0 || filtered > 0) fail(DB_CONTRACT_SKIPPED)

  if (manifestIds.length !== EXPECTED_TOTAL_ASSERTIONS) fail(DB_CONTRACT_TOPOLOGY_MISMATCH)
  const seenManifestIds = new Set<string>()
  for (const id of manifestIds) {
    if (typeof id !== 'string' || seenManifestIds.has(id) || !classifyTestId(id)) {
      fail(DB_CONTRACT_TOPOLOGY_MISMATCH)
    }
    seenManifestIds.add(id)
  }
  if (seenManifestIds.size !== EXPECTED_TOTAL_ASSERTIONS || SUITE_MANIFEST.some((entry) => !seenManifestIds.has(entry.id))) {
    fail(DB_CONTRACT_TOPOLOGY_MISMATCH)
  }

  const expectedCount = evidence.expectedCount ?? EXPECTED_TOTAL_ASSERTIONS
  if (expectedCount !== EXPECTED_TOTAL_ASSERTIONS || collected !== EXPECTED_TOTAL_ASSERTIONS) {
    fail(DB_CONTRACT_TOPOLOGY_MISMATCH)
  }

  const exactHead = typeof evidence.exactHead === 'string' ? evidence.exactHead.trim() : ''
  if (!exactHead) fail(DB_CONTRACT_METADATA)
  if (evidence.expectedExactHead !== undefined && evidence.expectedExactHead !== null) {
    if (exactHead !== evidence.expectedExactHead.trim()) fail(DB_CONTRACT_METADATA)
  }

  return {
    collected,
    passed,
    skipped,
    todo,
    pending,
    filtered,
  }
}

export interface ReporterTestCaseLike {
  readonly module?: { readonly moduleId?: string; readonly filepath?: string }
  readonly file?: { readonly filepath?: string }
  readonly filepath?: string
  readonly name?: string
  readonly fullName?: string
  /** Vitest 4 supplies the result through this zero-argument accessor. */
  readonly result?: () => ReporterTestResultLike | undefined
}

export interface ReporterTestResultLike {
  readonly state?: string
  readonly status?: string
  readonly skipped?: boolean
  readonly todo?: boolean
  readonly pending?: boolean
}

/** Minimal structural reporter contract; avoids pinning this helper to Vitest internals. */
export interface DbContractReporter {
  onTestRunStart?: () => void
  onTestCaseResult?: (testCase: ReporterTestCaseLike, result?: ReporterTestResultLike) => void
  onTestRunEnd?: () => void
}

const testPath = (testCase: ReporterTestCaseLike): string =>
  testCase.module?.moduleId ?? testCase.module?.filepath ?? testCase.file?.filepath ?? testCase.filepath ?? ''

const testTitle = (testCase: ReporterTestCaseLike): string => testCase.name ?? testCase.fullName ?? ''

/**
 * Vitest reporter for the required DB Contract config. It only records redaction-
 * safe counters; exact-head and cleanup facts come from CI metadata/environment.
 */
export default class ZeroSkipReporter implements DbContractReporter {
  private collected = 0
  private passed = 0
  private skipped = 0
  private todo = 0
  private pending = 0
  private filtered = 0
  private readonly unclassified: string[] = []
  private readonly manifestIds: string[] = []
  private runStartedAt = performance.now()

  getEvidenceSnapshot(): Pick<DbContractEvidence, 'collected' | 'passed' | 'skipped' | 'todo' | 'pending' | 'filtered'> {
    return {
      collected: this.collected,
      passed: this.passed,
      skipped: this.skipped,
      todo: this.todo,
      pending: this.pending,
      filtered: this.filtered,
    }
  }

  getManifestIds(): readonly string[] {
    return [...this.manifestIds]
  }

  onTestCaseResult(testCase: ReporterTestCaseLike, explicitResult?: ReporterTestResultLike): void {
    this.collected += 1

    // Vitest 4 calls this hook with only the test case. Older adapters may pass
    // a second result argument, so retain that compatibility without ever
    // dereferencing an absent result object.
    const result = explicitResult ?? testCase.result?.() ?? {}
    const state = result.state ?? result.status
    if (state === 'pass' || state === 'passed') this.passed += 1
    if (state === 'skip' || state === 'skipped' || result.skipped === true) this.skipped += 1
    if (state === 'todo' || result.todo === true) this.todo += 1
    if (state === 'pending' || result.pending === true) this.pending += 1

    const resolved = resolveTestId(testPath(testCase), testTitle(testCase))
    if (!resolved) this.unclassified.push('unclassified')
    else this.manifestIds.push(resolved.id)
  }

  onTestRunStart(): void {
    this.runStartedAt = performance.now()
  }

  onTestRunEnd(): void {
    // Vitest does not emit events for filtered tests. The locked count catches
    // that case; this explicit field documents the invariant for unit adapters.
    this.filtered = Math.max(0, EXPECTED_TOTAL_ASSERTIONS - this.collected)

    const path = telemetryPathFromEnv()
    recordPhaseDuration(path, 'test', performance.now() - this.runStartedAt)
    recordCounts(path, {
      collected: this.collected,
      passed: this.passed,
      skipped: this.skipped,
      todo: this.todo,
      pending: this.pending,
      filtered: this.filtered,
      unclassified: this.unclassified.length,
    })

    assertDbContractPreliminaryEvidence({
      collected: this.collected,
      passed: this.passed,
      skipped: this.skipped,
      todo: this.todo,
      pending: this.pending,
      filtered: this.filtered,
      unclassified: this.unclassified,
      manifestIds: this.manifestIds,
      exactHead: process.env.DB_CONTRACT_EXACT_HEAD ?? process.env.GITHUB_SHA,
      cleanupComplete: false,
      expectedExactHead: process.env.DB_CONTRACT_EXACT_HEAD,
    })
  }
}

export { ZeroSkipReporter }
