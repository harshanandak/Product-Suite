/**
 * `withDbBranch()` — the real-DB contract-tier harness (Lane B of the atomic-accept
 * wave). It provisions an ephemeral Neon branch, runs the FULL migration chain on
 * it, seeds a minimal baseline fixture, hands the test body a live `{ db, sql, seed }`,
 * and ALWAYS deletes the branch afterwards.
 *
 * This is the interface Lane A builds its accept/atomicity tests (2–9) against, so
 * the signature and the `Seed` shape below are the STABLE contract — treat them as
 * frozen. A test looks like:
 *
 * ```ts
 * import { withDbBranch } from '../harness'
 * import { createProposal } from '../../src/proposals/repository'
 * import { applyProposal } from '../../src/proposals/apply'
 *
 * await withDbBranch(async ({ sql, seed }) => {
 *   const p = await createProposal(sql, {
 *     tenant_id: seed.tenantId, run_id: seed.runId,
 *     target_type: 'work_item', operation: 'create', payload: { title: 'X' },
 *   })
 *   const r = await applyProposal(sql, { tenantIds: [seed.tenantId], approverUserId: seed.userId }, p.id)
 *   // …assert against the real branch…
 * })
 * ```
 *
 * The domain commands (`createWorkItem`, `applyProposal`, …) all take the raw neon
 * `sql` client, so `sql` is what most tests use; `db` (the drizzle client) is there
 * for query-builder reads if a test prefers it.
 *
 * Gating: every consumer wraps its `describe` in `describe.skipIf(!hasNeonCreds())`
 * so the suite is inert without `NEON_API_KEY`/`NEON_PROJECT_ID` (the mock suites
 * stay green on a normal `vitest run`); the dedicated `db-contract` CI job supplies
 * the secrets and actually runs it.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { Pool } from '@neondatabase/serverless'
import { createDb, createSql, type Database, type Sql } from '@product-suite/db'

import { createBranchLeaseCoordinator, type BranchLease } from './branch-lease'
import { createEphemeralBranch, deleteEphemeralBranchStrict, NeonBranchError, type EphemeralBranch } from './neon-branch'
import { workerRuntimeConfig } from './runtime-config'
export { assertConformanceMarker } from './conformance-marker'

/** The only migration-history variants accepted by the authority contract. */
export type NeonHistoryVariant = 'original-production' | 'repaired-bootstrap'

const CONFORMANCE_PHASES = [
  'disposable-create',
  'disposable-bootstrap',
  'derived-create',
  'derived-bootstrap',
  'runtime-probe-disposable',
  'runtime-probe-derived',
  'cleanup',
  'unknown',
] as const

export type ConformancePhase = typeof CONFORMANCE_PHASES[number]

const CANONICAL_BOOTSTRAP_CODES = [
  'DISPOSABLE_BOOTSTRAP_UNPROVEN',
  'RUNTIME_ROLE_PROVISION_UNPROVEN',
  'CANONICAL_FILE_LOAD_UNPROVEN',
  'REPAIRED_BOOTSTRAP_UNPROVEN',
  'REPAIRED_BASELINE_VERIFY_UNPROVEN',
  'ORIGINAL_PRODUCTION_FLOOR_UNPROVEN',
  'SYNTHETIC_0020_APPLY_UNPROVEN',
  'SYNTHETIC_0020_NOOP_UNPROVEN',
  'DB_SESSION_UNPROVEN',
  'ROLE_PROVISION_BEGIN_FAILED',
  'ROLE_PROVISION_AUTHORITY_FAILED',
  'ROLE_PROVISION_LOCK_FAILED',
  'ROLE_PROVISION_CREATE_ROLES_FAILED',
  'ROLE_PROVISION_GRANTS_FAILED',
  'ROLE_PROVISION_ROLE_STATE_FAILED',
  'ROLE_PROVISION_MEMBERSHIP_FAILED',
  'ROLE_PROVISION_COMMIT_FAILED',
] as const

type CanonicalBootstrapBaseCode = typeof CANONICAL_BOOTSTRAP_CODES[number]
type CanonicalBootstrapCode = CanonicalBootstrapBaseCode | `${CanonicalBootstrapBaseCode}_${string}`

function isCanonicalBootstrapCode(code: string): code is CanonicalBootstrapCode {
  return CANONICAL_BOOTSTRAP_CODES.some((base) =>
    code === base || (code.startsWith(`${base}_`) && /^[A-Z0-9_]+$/.test(code.slice(base.length + 1))),
  )
}

/** A redaction-safe conformance failure.  Messages are stable codes only. */
export interface ConformanceDiagnostic {
  endpointCategory: string
  statusClass: string
}

export class NeonConformanceError extends Error {
  readonly code: string
  readonly diagnostic?: ConformanceDiagnostic
  readonly phase?: string

  constructor(code: string, diagnostic?: ConformanceDiagnostic, phase?: string) {
    super(code)
    this.name = 'NeonConformanceError'
    this.code = code
    this.diagnostic = diagnostic
    this.phase = phase
  }
}

function conformanceFailure(code: string, diagnostic?: ConformanceDiagnostic, phase?: string): never {
  throw new NeonConformanceError(code, diagnostic, phase)
}

async function canonicalBootstrapStep<T>(
  code: CanonicalBootstrapBaseCode,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof NeonConformanceError && isCanonicalBootstrapCode(error.code)) throw error
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && isCanonicalBootstrapCode(error.code)) {
      throw new NeonConformanceError(error.code)
    }
    if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
      throw new NeonConformanceError(`${code}_${error.message}`)
    }
    throw new NeonConformanceError(code)
  }
}

function redactedConformanceDiagnostic(
  diagnostic: ConformanceDiagnostic | undefined,
): ConformanceDiagnostic | undefined {
  if (!diagnostic) return undefined
  return {
    endpointCategory: /^(?:projects|project|project-branches|project-operations|control-plane)$/.test(diagnostic.endpointCategory)
      ? diagnostic.endpointCategory
      : 'control-plane',
    statusClass: /^(?:[1-5]xx|network|unknown)$/.test(diagnostic.statusClass)
      ? diagnostic.statusClass
      : 'unknown',
  }
}

function redactedConformancePhase(phase: string | undefined): ConformancePhase | undefined {
  if (phase === undefined) return undefined
  return (CONFORMANCE_PHASES as readonly string[]).includes(phase)
    ? phase as ConformancePhase
    : 'unknown'
}

/** The minimum project/root evidence required for the disposable bootstrap lane. */
export interface DisposableTestProject {
  projectId: string
  branchId: string
  database: string
  branchIsRoot: boolean
  branchIsDefault: boolean
  authority: 'test-only' | 'production-derived' | 'unknown'
  historyVariant: NeonHistoryVariant
  catalogCount: number
}

/** The minimum branch evidence required for the production-history lane. */
export interface ProductionDerivedBranch {
  projectId: string
  branchId: string
  parentBranchId?: string
  productionProjectId: string
  branchIsRoot: boolean
  branchIsDefault: boolean
  authority: 'production-derived' | 'test-only' | 'unknown'
  historyVariant: NeonHistoryVariant
}

/** Evidence required before a real Neon conformance run can be called complete. */
export interface CleanupEvidence {
  projectCreated: boolean
  repairedBootstrapVerified: boolean
  productionDerivedBranchVerified: boolean
  branchDeleteRequested: boolean
  branchDeletionVerified: boolean
  projectDeleteRequested: boolean
  projectDeletionVerified: boolean
}

type NeonControlPlaneEnv = Partial<
  Pick<NodeJS.ProcessEnv, 'NEON_API_KEY' | 'NEON_PROJECT_ID' | 'NEON_PARENT_BRANCH_ID' | 'DB_CONTRACT_LIST_ONLY'>
>

export interface ConformanceCredentialStatus {
  status: 'READY' | 'INCOMPLETE'
  code?: 'NEON_CREDENTIALS_UNAVAILABLE'
}

/** True when the branch-level contract tier can reach the Neon control plane. */
export function hasNeonCreds(
  env: NeonControlPlaneEnv = process.env,
): boolean {
  if (env.DB_CONTRACT_LIST_ONLY === '1') return true
  return Boolean(env.NEON_API_KEY && env.NEON_PROJECT_ID)
}

/**
 * Task 8's required lane uses `NEON_PROJECT_ID` as the production/source project
 * and must create a distinct disposable project for the empty-root proof.
 * Missing credentials are INCOMPLETE, never a pass.
 */
export function conformanceCredentialStatus(
  env: NeonControlPlaneEnv = process.env,
): ConformanceCredentialStatus {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) {
    return { status: 'INCOMPLETE', code: 'NEON_CREDENTIALS_UNAVAILABLE' }
  }
  return { status: 'READY' }
}

export interface NeonProjectHandle extends DisposableTestProject {
  connectionUri: string
  runtimeConnectionUri: string
}

export interface NeonDerivedHandle extends ProductionDerivedBranch {
  connectionUri: string
  runtimeConnectionUri: string
}

export interface NeonControlPlane {
  createDisposableProject(): Promise<NeonProjectHandle>
  createProductionDerivedBranch(): Promise<NeonDerivedHandle>
  proveVariant(connectionUri: string, variant: NeonHistoryVariant): Promise<void>
  probeLeastPrivilege(connectionUri: string): Promise<void>
  deleteProject(projectId: string): Promise<void>
  verifyProjectDeleted(projectId: string): Promise<void>
  deleteBranch(projectId: string, branchId: string): Promise<void>
  verifyBranchDeleted(projectId: string, branchId: string): Promise<void>
  cleanupRetainedResources(): Promise<void>
}

interface NeonOperation {
  id: string
  status: string
  action?: string
}

function controlPlaneBase(): string {
  return process.env.NEON_API_BASE ?? 'https://console.neon.tech/api/v2'
}

function controlPlaneConfig(env: NeonControlPlaneEnv): { apiKey: string; sourceProjectId: string } {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) conformanceFailure('NEON_CREDENTIALS_UNAVAILABLE')
  return { apiKey: env.NEON_API_KEY!, sourceProjectId: env.NEON_PROJECT_ID! }
}

const CONTROL_PLANE_TIMEOUT_MS = 15_000
const TRANSIENT_GET_STATUSES = new Set([423, 429, 503])
const TRANSIENT_DELETE_STATUSES = new Set([409, 423, 429, 503])
const ACCEPTED_DELETE_STATUSES = new Set([200, 202, 204, 404])
const CONTROL_PLANE_RETRY_DELAYS_MS = [100, 250, 500] as const

type ControlPlaneFetchOptions = {
  acceptedStatuses?: readonly number[]
  retryDelaysMs?: readonly number[]
}

function controlPlaneSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function controlPlaneFailureCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH_FAILED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500 && status <= 599) return 'UNAVAILABLE'
  return 'REQUEST_FAILED'
}

function controlPlaneEndpointCategory(path: string): string {
  const pathname = path.split('?', 1)[0] ?? path
  if (pathname === '/projects') return 'projects'
  if (/^\/projects\/[^/]+\/operations\/[^/]+$/.test(pathname)) return 'project-operations'
  if (/^\/projects\/[^/]+\/branches(?:\/[^/]+)?$/.test(pathname)) return 'project-branches'
  if (/^\/projects\/[^/]+$/.test(pathname)) return 'project'
  return 'control-plane'
}

function controlPlaneStatusClass(status: number): string {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? `${Math.floor(status / 100)}xx`
    : 'unknown'
}

/** Fetch JSON without ever surfacing response bodies, URLs, or credentials. */
async function controlPlaneFetchWith(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
  fetcher: typeof fetch,
  options: ControlPlaneFetchOptions = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const retryDelaysMs = options.retryDelaysMs ?? CONTROL_PLANE_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt += 1) {
    let response: Response
    try {
      response = await fetcher(`${controlPlaneBase()}${path}`, {
        method: init.method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS),
      })
    } catch {
      if ((init.method === 'GET' || init.method === 'DELETE') && attempt < retryDelaysMs.length) {
        await controlPlaneSleep(retryDelaysMs[attempt] ?? 0)
        continue
      }
      conformanceFailure('NETWORK_FAILED', {
        endpointCategory: controlPlaneEndpointCategory(path),
        statusClass: 'network',
      })
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (response.ok || options.acceptedStatuses?.includes(response.status) || (init.method === 'DELETE' && ACCEPTED_DELETE_STATUSES.has(response.status))) {
      return { status: response.status, body }
    }
    const retryable = init.method === 'GET'
      ? TRANSIENT_GET_STATUSES.has(response.status)
      : init.method === 'DELETE' && TRANSIENT_DELETE_STATUSES.has(response.status)
    if (retryable && attempt < retryDelaysMs.length) {
      await controlPlaneSleep(retryDelaysMs[attempt] ?? 0)
      continue
    }
    conformanceFailure(controlPlaneFailureCode(response.status), {
      endpointCategory: controlPlaneEndpointCategory(path),
      statusClass: controlPlaneStatusClass(response.status),
    })
  }
}

async function controlPlaneFetch(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
  options?: ControlPlaneFetchOptions,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return controlPlaneFetchWith(apiKey, path, init, fetch, options)
}

/** Test seam for the retry contract; production always uses the native fetch implementation. */
export async function controlPlaneFetchForTest(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
  fetcher: typeof fetch,
  retryDelaysMs: readonly number[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  return controlPlaneFetchWith(apiKey, path, init, fetcher, { retryDelaysMs })
}

async function pollControlPlaneDeletion(
  apiKey: string,
  path: string,
  failureCode: 'PROJECT_DELETION_UNPROVEN' | 'BRANCH_DELETION_UNPROVEN',
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const deadline = Date.now() + CONTROL_PLANE_TIMEOUT_MS
  while (Date.now() <= deadline) {
    const response = await controlPlaneFetchWith(apiKey, path, { method: 'GET' }, fetcher, { acceptedStatuses: [404] })
    if (response.status === 404) return
    await controlPlaneSleep(CONTROL_PLANE_RETRY_DELAYS_MS.at(-1) ?? 500)
  }
  conformanceFailure(failureCode)
}

async function waitControlPlaneOperations(
  apiKey: string,
  projectId: string,
  operations: NeonOperation[] = [],
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const deadline = Date.now() + CONTROL_PLANE_TIMEOUT_MS
  for (const operation of operations) {
    let status = operation.status
    while (status !== 'finished') {
      if (status === 'failed' || status === 'cancelled') conformanceFailure('NEON_OPERATION_FAILED')
      if (Date.now() > deadline) conformanceFailure('NEON_OPERATION_TIMEOUT')
      await controlPlaneSleep(CONTROL_PLANE_RETRY_DELAYS_MS.at(-1) ?? 500)
      const result = await controlPlaneFetchWith(apiKey, `/projects/${projectId}/operations/${operation.id}`, { method: 'GET' }, fetcher)
      const current = result.body.operation as { status?: unknown } | undefined
      status = typeof current?.status === 'string' ? current.status : status
    }
  }
}

interface ValidatedProjectResponse {
  projectId: string
  projectName: string
  branchId: string
  connectionUri: string
  runtimeConnectionUri: string
}

type NeonConnectionPurpose = 'migration' | 'runtime'

interface NeonConnectionBinding {
  projectId: string
  branchId: string
  purpose: NeonConnectionPurpose
}

interface NeonConnectionParameters {
  database?: unknown
  password?: unknown
  role?: unknown
  host?: unknown
  pooler_host?: unknown
}

interface NeonConnectionDetails {
  connection_uri?: unknown
  connection_parameters?: NeonConnectionParameters
}

interface NeonEndpointDetails {
  id?: unknown
  host?: unknown
  project_id?: unknown
  branch_id?: unknown
  type?: unknown
}

const NEON_RESOURCE_ID = /^[a-z0-9-]{1,60}$/
const NEON_HOSTNAME = /^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/
const NEON_TLS_MODES = new Set(['require', 'verify-ca', 'verify-full'])

function validatedNeonConnectionUri(
  body: Record<string, unknown>,
  expected: NeonConnectionBinding,
  candidateConnectionUri?: string,
): string {
  const connections = Array.isArray(body.connection_uris) ? body.connection_uris as NeonConnectionDetails[] : []
  const endpoints = Array.isArray(body.endpoints) ? body.endpoints as NeonEndpointDetails[] : []
  if (connections.length !== 1 || endpoints.length !== 1) conformanceFailure('NEON_CONNECTION_BINDING_INVALID')

  const connection = connections[0]
  const parameters = connection?.connection_parameters
  const endpoint = endpoints[0]
  const directConnectionUri = typeof connection?.connection_uri === 'string' ? connection.connection_uri : ''
  const endpointId = typeof endpoint?.id === 'string' ? endpoint.id : ''
  const endpointHost = typeof endpoint?.host === 'string' ? endpoint.host : ''
  const directHost = typeof parameters?.host === 'string' ? parameters.host : ''
  const poolerHost = typeof parameters?.pooler_host === 'string' ? parameters.pooler_host : ''
  if (
    endpoint?.project_id !== expected.projectId
    || endpoint.branch_id !== expected.branchId
    || endpoint.type !== 'read_write'
    || !NEON_RESOURCE_ID.test(endpointId)
    || !NEON_HOSTNAME.test(endpointHost)
    || endpointHost !== directHost
    || !NEON_HOSTNAME.test(poolerHost)
  ) {
    conformanceFailure('NEON_CONNECTION_BINDING_INVALID')
  }

  let directUrl: URL
  try {
    directUrl = new URL(directConnectionUri)
  } catch {
    conformanceFailure('NEON_CONNECTION_URL_INVALID')
  }
  if (directUrl.hostname !== directHost) conformanceFailure('NEON_CONNECTION_BINDING_INVALID')
  let connectionUri = candidateConnectionUri
  if (!connectionUri) {
    if (expected.purpose === 'migration') {
      connectionUri = directConnectionUri
    } else {
      directUrl.hostname = poolerHost
      connectionUri = directUrl.toString()
    }
  }
  let url: URL
  try {
    url = new URL(connectionUri)
  } catch {
    conformanceFailure('NEON_CONNECTION_URL_INVALID')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !NEON_HOSTNAME.test(url.hostname)) {
    conformanceFailure('NEON_CONNECTION_PROVIDER_INVALID')
  }
  if (url.pathname !== '/neondb' || parameters?.database !== 'neondb') {
    conformanceFailure('NEON_CONNECTION_DATABASE_INVALID')
  }
  if (!NEON_TLS_MODES.has(url.searchParams.get('sslmode') ?? '')) {
    conformanceFailure('NEON_CONNECTION_TLS_REQUIRED')
  }
  const expectedHost = expected.purpose === 'runtime' ? poolerHost : directHost
  const expectedPrefix = expected.purpose === 'runtime' ? `${endpointId}-pooler.` : `${endpointId}.`
  if (url.hostname !== expectedHost || !url.hostname.startsWith(expectedPrefix)) {
    conformanceFailure('NEON_CONNECTION_PURPOSE_INVALID')
  }
  return connectionUri
}

/** Redaction-safe structural and control-plane binding proof for a Neon URL. */
export function assertNeonConnectionBinding(
  body: Record<string, unknown>,
  expected: NeonConnectionBinding,
  candidateConnectionUri?: string,
): { status: 'READY' } {
  validatedNeonConnectionUri(body, expected, candidateConnectionUri)
  return { status: 'READY' }
}

function safeProjectIdentity(
  body: Record<string, unknown>,
  sourceProjectId: string,
): { projectId: string } {
  const project = body.project as { id?: unknown } | undefined
  const projectId = typeof project?.id === 'string' ? project.id : ''
  if (!NEON_RESOURCE_ID.test(projectId) || projectId === sourceProjectId) {
    conformanceFailure('NEON_PROJECT_RESPONSE_INVALID')
  }
  return { projectId }
}

async function sourceProjectOrganizationId(
  apiKey: string,
  sourceProjectId: string,
  fetcher: typeof fetch,
): Promise<string> {
  if (!NEON_RESOURCE_ID.test(sourceProjectId)) conformanceFailure('NEON_SOURCE_PROJECT_INVALID')
  const result = await controlPlaneFetchWith(apiKey, `/projects/${sourceProjectId}`, { method: 'GET' }, fetcher)
  const project = result.body.project as { id?: unknown; org_id?: unknown } | undefined
  const organizationId = typeof project?.org_id === 'string' ? project.org_id : ''
  if (project?.id !== sourceProjectId || !NEON_RESOURCE_ID.test(organizationId)) {
    conformanceFailure('NEON_SOURCE_PROJECT_METADATA_INVALID')
  }
  return organizationId
}

function projectResponse(
  body: Record<string, unknown>,
  safeIdentity: { projectId: string },
  expectedName: string,
): ValidatedProjectResponse {
  const project = body.project as { id?: unknown; name?: unknown } | undefined
  const branch = body.branch as { id?: unknown; parent_id?: unknown; default?: unknown } | undefined
  const projectId = typeof project?.id === 'string' ? project.id : ''
  const projectName = typeof project?.name === 'string' ? project.name : ''
  const branchId = typeof branch?.id === 'string' ? branch.id : ''
  if (projectId !== safeIdentity.projectId || projectName !== expectedName) {
    conformanceFailure('NEON_PROJECT_RESPONSE_INVALID')
  }
  if (!NEON_RESOURCE_ID.test(branchId) || branch?.default !== true || branch.parent_id != null) {
    conformanceFailure('NEON_PROJECT_ROOT_INVALID')
  }
  const connectionUri = validatedNeonConnectionUri(body, { projectId, branchId, purpose: 'migration' })
  const runtimeConnectionUri = validatedNeonConnectionUri(body, { projectId, branchId, purpose: 'runtime' })
  return { projectId, projectName, branchId, connectionUri, runtimeConnectionUri }
}

function assertProjectRead(
  body: Record<string, unknown>,
  expected: Pick<ValidatedProjectResponse, 'projectId' | 'projectName'>,
): void {
  const project = body.project as { id?: unknown; name?: unknown } | undefined
  if (project?.id !== expected.projectId || project.name !== expected.projectName) {
    conformanceFailure('NEON_PROJECT_METADATA_UNPROVEN')
  }
}

function assertRootBranchRead(body: Record<string, unknown>, branchId: string): void {
  const branch = body.branch as { id?: unknown; parent_id?: unknown; default?: unknown } | undefined
  if (branch?.id !== branchId || branch.default !== true || branch.parent_id != null) {
    conformanceFailure('NEON_PROJECT_ROOT_UNPROVEN')
  }
}

function assertNeondbRead(body: Record<string, unknown>): void {
  const databases = Array.isArray(body.databases) ? body.databases as Array<{ name?: unknown }> : []
  if (databases.length !== 1 || databases[0]?.name !== 'neondb') {
    conformanceFailure('NEON_PROJECT_DATABASE_UNPROVEN')
  }
}

function branchResponse(
  body: Record<string, unknown>,
  expected: { projectId: string; branchId: string; branchName: string; parentBranchId: string },
): { branchId: string; connectionUri: string; runtimeConnectionUri: string } {
  const branch = body.branch as { id?: unknown; name?: unknown; parent_id?: unknown; default?: unknown } | undefined
  const branchId = typeof branch?.id === 'string' ? branch.id : ''
  if (branchId !== expected.branchId || branch?.name !== expected.branchName) {
    conformanceFailure('NEON_BRANCH_RESPONSE_INVALID')
  }
  if (branch.parent_id !== expected.parentBranchId || branch.default !== false) {
    conformanceFailure('PRODUCTION_DERIVED_PARENT_MISMATCH')
  }
  const connectionUri = validatedNeonConnectionUri(body, {
    projectId: expected.projectId,
    branchId,
    purpose: 'migration',
  })
  const runtimeConnectionUri = validatedNeonConnectionUri(body, {
    projectId: expected.projectId,
    branchId,
    purpose: 'runtime',
  })
  return { branchId, connectionUri, runtimeConnectionUri }
}

function safeBranchIdentity(
  body: Record<string, unknown>,
  protectedBranchIds: readonly string[],
): { branchId: string } {
  const branch = body.branch as { id?: unknown } | undefined
  const branchId = typeof branch?.id === 'string' ? branch.id : ''
  if (
    !NEON_RESOURCE_ID.test(branchId)
    || protectedBranchIds.includes(branchId)
  ) {
    conformanceFailure('NEON_BRANCH_RESPONSE_INVALID')
  }
  return { branchId }
}

function assertDerivedBranchRead(
  body: Record<string, unknown>,
  expected: { branchId: string; branchName: string; parentBranchId: string },
): void {
  const branch = body.branch as { id?: unknown; name?: unknown; parent_id?: unknown; default?: unknown } | undefined
  if (branch?.id !== expected.branchId || branch.name !== expected.branchName || branch.parent_id !== expected.parentBranchId || branch.default !== false) {
    conformanceFailure('PRODUCTION_DERIVED_METADATA_UNPROVEN')
  }
}

const PRODUCTION_BRANCH_PAGE_LIMIT = 100
const PRODUCTION_BRANCH_MAX_PAGES = 1000
type ProductionBranchSummary = { id?: unknown; parent_id?: unknown; default?: unknown }

async function listAllProductionBranches(
  apiKey: string,
  sourceProjectId: string,
  fetcher: typeof fetch,
): Promise<ProductionBranchSummary[]> {
  const all: ProductionBranchSummary[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < PRODUCTION_BRANCH_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(PRODUCTION_BRANCH_PAGE_LIMIT) })
    if (cursor) params.set('cursor', cursor)
    const result = await controlPlaneFetchWith(
      apiKey,
      `/projects/${sourceProjectId}/branches?${params.toString()}`,
      { method: 'GET' },
      fetcher,
    )
    const rawBranches = result.body.branches
    if (!Array.isArray(rawBranches) || rawBranches.length === 0 || rawBranches.some((branch) => (
      !branch || typeof branch !== 'object' || Array.isArray(branch)
    ))) {
      conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
    }
    all.push(...rawBranches as ProductionBranchSummary[])

    const pagination = result.body.pagination
    if (pagination !== undefined && (
      !pagination || typeof pagination !== 'object' || Array.isArray(pagination)
    )) {
      conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
    }
    const next = (pagination as { next?: unknown } | undefined)?.next
    if (next === undefined) return all
    if (typeof next !== 'string' || next.length === 0 || seenCursors.has(next)) {
      conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
    }
    seenCursors.add(next)
    cursor = next
  }

  conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
}

async function productionParentBranchId(
  apiKey: string,
  sourceProjectId: string,
  requestedParentBranchId: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const projectResult = await controlPlaneFetchWith(apiKey, `/projects/${sourceProjectId}`, { method: 'GET' }, fetcher)
  const project = projectResult.body.project as { id?: unknown } | undefined
  if (project?.id !== sourceProjectId) conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
  const branches = await listAllProductionBranches(apiKey, sourceProjectId, fetcher)
  const malformed = branches.some((branch) => (
    typeof branch.id !== 'string'
    || !NEON_RESOURCE_ID.test(branch.id)
    || typeof branch.default !== 'boolean'
    || (branch.parent_id !== undefined && branch.parent_id !== null && typeof branch.parent_id !== 'string')
  ))
  const roots = branches.filter((branch) => branch.default === true && (branch.parent_id === null || branch.parent_id === undefined))
  if (malformed || roots.length !== 1) {
    conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
  }
  const rootBranchId = roots[0]!.id as string
  if (requestedParentBranchId !== undefined && requestedParentBranchId !== rootBranchId) {
    conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
  }
  return rootBranchId
}

/** Native-fetch control-plane adapter: project/root + production-derived branch. */
export function createNeonControlPlane(env: NeonControlPlaneEnv = process.env, fetcher: typeof fetch = fetch): NeonControlPlane {
  const { apiKey, sourceProjectId } = controlPlaneConfig(env)
  const request = (path: string, init: { method: string; body?: unknown }) => controlPlaneFetchWith(apiKey, path, init, fetcher)
  let retainedProjectId: string | undefined
  let retainedBranch: { projectId: string; branchId: string; parentBranchId: string; rootBranchId: string } | undefined

  const assertSafeProjectDelete = (projectId: string): void => {
    if (!retainedProjectId || projectId !== retainedProjectId || projectId === sourceProjectId) {
      conformanceFailure('UNSAFE_PROJECT_DELETE_TARGET')
    }
  }
  const assertSafeBranchDelete = (projectId: string, branchId: string): void => {
    if (!retainedBranch || projectId !== sourceProjectId || projectId !== retainedBranch.projectId || branchId !== retainedBranch.branchId) {
      conformanceFailure('UNSAFE_BRANCH_DELETE_TARGET')
    }
    if (branchId === retainedBranch.parentBranchId || branchId === retainedBranch.rootBranchId) {
      conformanceFailure('UNSAFE_BRANCH_DELETE_TARGET')
    }
  }

  return {
    async createDisposableProject() {
      const projectName = `product-suite-test-only-repaired-bootstrap-${Date.now()}`
      const organizationId = await sourceProjectOrganizationId(apiKey, sourceProjectId, fetcher)
      const result = await request('/projects', {
        method: 'POST',
        body: { project: { name: projectName, pg_version: 17, org_id: organizationId } },
      })
      const safeIdentity = safeProjectIdentity(result.body, sourceProjectId)
      retainedProjectId = safeIdentity.projectId
      const created = projectResponse(result.body, safeIdentity, projectName)
      await waitControlPlaneOperations(apiKey, created.projectId, (result.body.operations ?? []) as NeonOperation[], fetcher)
      const projectRead = await request(`/projects/${created.projectId}`, { method: 'GET' })
      assertProjectRead(projectRead.body, created)
      const branchRead = await request(`/projects/${created.projectId}/branches/${created.branchId}`, { method: 'GET' })
      assertRootBranchRead(branchRead.body, created.branchId)
      const databaseRead = await request(`/projects/${created.projectId}/branches/${created.branchId}/databases`, { method: 'GET' })
      assertNeondbRead(databaseRead.body)
      const sql = createSql(created.connectionUri)
      const rows = await query<{ count: string }>(sql, `select count(*)::text as count from information_schema.tables where table_schema = 'public'`)
      return {
        ...created,
        database: 'neondb',
        branchIsRoot: true,
        branchIsDefault: true,
        authority: 'test-only',
        historyVariant: 'repaired-bootstrap',
        catalogCount: Number(rows[0]?.count ?? 0),
        connectionUri: created.connectionUri,
        runtimeConnectionUri: created.runtimeConnectionUri,
      }
    },
    async createProductionDerivedBranch() {
      const parentBranchId = await productionParentBranchId(apiKey, sourceProjectId, env.NEON_PARENT_BRANCH_ID, fetcher)
      const branchName = `db-contract-production-original-${Date.now()}`
      // Production-derived conformance branches are disposable even when a
      // runner is cancelled between creation and cleanup.
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const body = {
        endpoints: [{ type: 'read_write' }],
        branch: { name: branchName, parent_id: parentBranchId, expires_at: expiresAt },
      }
      const result = await request(`/projects/${sourceProjectId}/branches`, { method: 'POST', body })
      const safeIdentity = safeBranchIdentity(result.body, [parentBranchId])
      retainedBranch = {
        projectId: sourceProjectId,
        branchId: safeIdentity.branchId,
        parentBranchId,
        rootBranchId: parentBranchId,
      }
      const created = branchResponse(result.body, {
        projectId: sourceProjectId,
        branchId: safeIdentity.branchId,
        branchName,
        parentBranchId,
      })
      await waitControlPlaneOperations(apiKey, sourceProjectId, (result.body.operations ?? []) as NeonOperation[], fetcher)
      const branchRead = await request(`/projects/${sourceProjectId}/branches/${created.branchId}`, { method: 'GET' })
      assertDerivedBranchRead(branchRead.body, { branchId: created.branchId, branchName, parentBranchId })
      return {
        ...created,
        projectId: sourceProjectId,
        productionProjectId: sourceProjectId,
        parentBranchId,
        branchIsRoot: false,
        branchIsDefault: false,
        authority: 'production-derived',
        historyVariant: 'original-production',
      }
    },
    async proveVariant(connectionUri, variant) { await proveCanonicalVariant(connectionUri, variant) },
    async probeLeastPrivilege(connectionUri) {
      const sql = createSql(connectionUri)
      await proveRuntimeLoginPrivileges(sql, connectionUri)
    },
    async deleteProject(projectId) {
      assertSafeProjectDelete(projectId)
      await request(`/projects/${projectId}`, { method: 'DELETE' })
    },
    async verifyProjectDeleted(projectId) { await pollControlPlaneDeletion(apiKey, `/projects/${projectId}`, 'PROJECT_DELETION_UNPROVEN', fetcher) },
    async deleteBranch(projectId, branchId) {
      assertSafeBranchDelete(projectId, branchId)
      await request(`/projects/${projectId}/branches/${branchId}`, { method: 'DELETE' })
    },
    async verifyBranchDeleted(projectId, branchId) { await pollControlPlaneDeletion(apiKey, `/projects/${projectId}/branches/${branchId}`, 'BRANCH_DELETION_UNPROVEN', fetcher) },
    async cleanupRetainedResources() {
      let cleanupFailed = false
      if (retainedBranch) {
        try {
          assertSafeBranchDelete(retainedBranch.projectId, retainedBranch.branchId)
          await request(`/projects/${retainedBranch.projectId}/branches/${retainedBranch.branchId}`, { method: 'DELETE' })
          await pollControlPlaneDeletion(apiKey, `/projects/${retainedBranch.projectId}/branches/${retainedBranch.branchId}`, 'BRANCH_DELETION_UNPROVEN', fetcher)
          retainedBranch = undefined
        } catch { cleanupFailed = true }
      }
      if (retainedProjectId) {
        try {
          assertSafeProjectDelete(retainedProjectId)
          await request(`/projects/${retainedProjectId}`, { method: 'DELETE' })
          await pollControlPlaneDeletion(apiKey, `/projects/${retainedProjectId}`, 'PROJECT_DELETION_UNPROVEN', fetcher)
          retainedProjectId = undefined
        } catch { cleanupFailed = true }
      }
      if (cleanupFailed) conformanceFailure('PROJECT_CLEANUP_UNPROVEN')
    },
  }
}

interface CanonicalMigrationFile {
  tag: string
  file: string
  sql: string
  hash: string
  timestamp: number
}

interface CanonicalEvidence {
  ok: boolean
  status?: string
  applied?: Array<{ tag?: string } | string>
}

type SessionAdapter = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

type SessionClient = {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
  release(): void
}

type SessionPool = {
  connect(): Promise<SessionClient>
  end(): Promise<void>
}

export type SessionPoolFactory = () => SessionPool

async function preservePrimaryOnCleanup<T>(
  body: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let value!: T
  let primary: unknown
  let hasPrimary = false
  let hasFailure = false
  try {
    value = await body()
  } catch (error) {
    primary = error
    hasPrimary = true
    hasFailure = true
  }
  try {
    await cleanup()
  } catch (error) {
    hasFailure = true
    if (!hasPrimary) primary = error
  }
  if (hasFailure) throw primary
  return value
}

async function withDatabaseSession<T>(
  connectionUri: string,
  body: (adapter: SessionAdapter) => Promise<T>,
  poolFactory: SessionPoolFactory = () => new Pool({ connectionString: connectionUri, max: 1 }) as unknown as SessionPool,
): Promise<T> {
  const pool = poolFactory()
  let client: SessionClient | undefined
  return preservePrimaryOnCleanup(
    async () => {
      client = await pool.connect()
      return body({
        query: async (text, params = []) => {
          const result = await client!.query(text, params)
          return { rows: result.rows as Record<string, unknown>[] }
        },
      })
    },
    async () => {
      let cleanupError: unknown
      try { client?.release() } catch (error) { cleanupError = error }
      try { await pool.end() } catch (error) { if (cleanupError === undefined) cleanupError = error }
      if (cleanupError !== undefined) throw cleanupError
    },
  )
}

function canonicalFilesForVariant(
  variant: NeonHistoryVariant,
  loadFiles: () => CanonicalMigrationFile[],
): CanonicalMigrationFile[] {
  const files = loadFiles()
  if (variant !== 'original-production') return files
  const manifestPath = resolve(MIGRATIONS_DIR, '../../../docs/history/database-migrations/manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    drizzle?: { repairs?: Array<{ path?: string; original?: { lfSha256?: string } }> }
  }
  const originalHashes = new Map(
    (manifest.drizzle?.repairs ?? []).flatMap((repair) =>
      repair.path && repair.original?.lfSha256 ? [[repair.path, repair.original.lfSha256] as const] : [],
    ),
  )
  return files.map((file) => ({ ...file, hash: originalHashes.get(file.file) ?? file.hash }))
}

export function loadCanonicalFilesForVariant(
  variant: NeonHistoryVariant,
  loadFiles: () => CanonicalMigrationFile[],
): Promise<CanonicalMigrationFile[]> {
  return canonicalBootstrapStep(
    'CANONICAL_FILE_LOAD_UNPROVEN',
    () => canonicalFilesForVariant(variant, loadFiles),
  )
}

function appliedTags(evidence: CanonicalEvidence): string[] {
  return (evidence.applied ?? []).flatMap((entry) => {
    const tag = typeof entry === 'string' ? entry : entry.tag
    return tag ? [tag] : []
  })
}

export function variantMigrationContract(variant: NeonHistoryVariant): {
  baselineFloor: '0017' | '0018' | '0019'
  baselineCount: 18 | 20
  declared: string[]
  finalFloor: '0020'
} {
  return variant === 'repaired-bootstrap'
    ? { baselineFloor: '0019', baselineCount: 20, declared: ['0020'], finalFloor: '0020' }
    : { baselineFloor: '0017', baselineCount: 18, declared: ['0018', '0019', '0020'], finalFloor: '0020' }
}

export function nextSyntheticMigrationTimestamp(
  files: ReadonlyArray<Pick<CanonicalMigrationFile, 'timestamp'>>,
): number {
  const timestamps = files.map((file) => file.timestamp)
  const latest = Math.max(...timestamps)
  if (timestamps.length === 0 || !Number.isSafeInteger(latest) || latest < 0 || latest === Number.MAX_SAFE_INTEGER) {
    conformanceFailure('CANONICAL_FILE_LOAD_UNPROVEN')
  }
  return latest + 1
}

export function effectiveTimestampFilesForVariant<T>(
  variant: NeonHistoryVariant,
  canonicalFiles: T[],
  normalizeProduction: (files: T[]) => T[],
): T[] {
  return variant === 'original-production'
    ? normalizeProduction(canonicalFiles)
    : canonicalFiles
}

export function resolveDeclaredMigrationTags(
  files: ReadonlyArray<{ tag: string }>,
  declared: readonly string[],
): string[] {
  return declared.map((declaration) => {
    const prefix = /^(\d+)/.exec(declaration)?.[1]
    const matches = prefix
      ? files.filter((file) => /^(\d+)/.exec(file.tag)?.[1] === prefix)
      : []
    const match = matches[0]
    if (!match || matches.length !== 1) conformanceFailure('CANONICAL_FILE_LOAD_UNPROVEN')
    return match.tag
  })
}

async function proveCanonicalVariant(connectionUri: string, variant: NeonHistoryVariant): Promise<void> {
  // Dynamic loading keeps Vitest from transforming the Bun-native JSON import attribute in the canonical CLI module.
  // @ts-expect-error Canonical JavaScript runner has no declaration file; its surface is narrowed here.
  const migrationRunner = await import('../../../../scripts/migrate-database.mjs') as {
    applyMigrations(input: Record<string, unknown>): Promise<CanonicalEvidence>
    bootstrapMigrations(input: Record<string, unknown>): Promise<CanonicalEvidence>
    loadMigrationFiles(): CanonicalMigrationFile[]
    productionPreflightFiles(files: CanonicalMigrationFile[]): CanonicalMigrationFile[]
    verifyMigrations(input: Record<string, unknown>): Promise<CanonicalEvidence>
  }
  // @ts-expect-error Canonical JavaScript provisioner has no declaration file; its surface is narrowed here.
  const roleProvisioner = await import('../../../../scripts/provision-database-roles.mjs') as {
    provisionDatabaseRoles(input: Record<string, unknown>): Promise<CanonicalEvidence>
  }
  await withCanonicalDatabaseSession(connectionUri, async (adapter) => {
    const authority = {
      environment: variant === 'original-production' ? 'conformance-original' : 'test',
      historyVariant: variant,
    }
    const provisioned = await canonicalBootstrapStep(
      'RUNTIME_ROLE_PROVISION_UNPROVEN',
      () => roleProvisioner.provisionDatabaseRoles({ adapter, databaseUrl: connectionUri, environment: authority.environment }),
    )
    if (!provisioned.ok) conformanceFailure('RUNTIME_ROLE_PROVISION_UNPROVEN')

    const canonicalFiles = await loadCanonicalFilesForVariant(variant, migrationRunner.loadMigrationFiles)
    const contract = variantMigrationContract(variant)
    let baseline: CanonicalEvidence
    if (variant === 'repaired-bootstrap') {
      const bootstrapped = await canonicalBootstrapStep(
        'REPAIRED_BOOTSTRAP_UNPROVEN',
        () => migrationRunner.bootstrapMigrations({
          adapter,
          files: canonicalFiles,
          declared: canonicalFiles.map((file) => file.tag),
          authority,
        }),
      )
      if (!bootstrapped.ok || bootstrapped.status !== 'BOOTSTRAPPED') conformanceFailure('REPAIRED_BOOTSTRAP_UNPROVEN')
      baseline = await canonicalBootstrapStep(
        'REPAIRED_BASELINE_VERIFY_UNPROVEN',
        () => migrationRunner.verifyMigrations({ adapter, files: canonicalFiles, declared: [], expectedFloor: contract.baselineFloor, expectedCount: contract.baselineCount, authority, observedVariant: variant }),
      )
      if (!baseline.ok || baseline.status !== 'NOOP') conformanceFailure('REPAIRED_BASELINE_VERIFY_UNPROVEN')
    } else {
      baseline = await canonicalBootstrapStep(
        'ORIGINAL_PRODUCTION_FLOOR_UNPROVEN',
        () => migrationRunner.verifyMigrations({ adapter, files: canonicalFiles, declared: [], expectedFloor: contract.baselineFloor, expectedCount: contract.baselineCount, authority, observedVariant: variant }),
      )
      if (!baseline.ok || baseline.status !== 'NOOP') conformanceFailure('ORIGINAL_PRODUCTION_FLOOR_UNPROVEN')
    }

    const effectiveTimestampFiles = effectiveTimestampFilesForVariant(
      variant,
      canonicalFiles,
      migrationRunner.productionPreflightFiles,
    )
    const syntheticSql = 'SELECT 1;'
    const synthetic: CanonicalMigrationFile = {
      tag: '0020',
      file: '0020_task8_synthetic.sql',
      sql: syntheticSql,
      hash: createHash('sha256').update(syntheticSql.replace(/\r\n?/g, '\n'), 'utf8').digest('hex'),
      timestamp: nextSyntheticMigrationTimestamp(effectiveTimestampFiles),
    }
    const files = [...canonicalFiles, synthetic]
    const declared = resolveDeclaredMigrationTags(files, contract.declared)
    const applied = await canonicalBootstrapStep(
      'SYNTHETIC_0020_APPLY_UNPROVEN',
      () => migrationRunner.applyMigrations({
        adapter,
        applied: appliedTags(baseline),
        files,
        declared,
        authority,
        observedVariant: variant,
      }),
    )
    if (!applied.ok || applied.status !== 'APPLIED') conformanceFailure('SYNTHETIC_0020_APPLY_UNPROVEN')
    const verified = await canonicalBootstrapStep(
      'SYNTHETIC_0020_NOOP_UNPROVEN',
      () => migrationRunner.verifyMigrations({ adapter, files, declared: [], expectedFloor: contract.finalFloor, authority, observedVariant: variant }),
    )
    if (!verified.ok || verified.status !== 'NOOP') conformanceFailure('SYNTHETIC_0020_NOOP_UNPROVEN')
  })
}


function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function runtimeLoginUri(connectionUri: string, login: string, password: string): string {
  const url = new URL(connectionUri)
  url.username = login
  url.password = password
  return url.toString()
}

async function expectPermissionDenied(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if ((error as { code?: unknown })?.code === '42501') return
  }
  conformanceFailure('RUNTIME_DENIAL_UNPROVEN')
}

const RUNTIME_ROLE_CATALOG_SQL = `
  select
    role.rolname as name,
    role.rolcanlogin as "canLogin",
    role.rolsuper as "isSuperuser",
    role.rolcreaterole as "canCreateRole",
    role.rolcreatedb as "canCreateDb",
    member.rolname as member,
    member.rolcanlogin as "memberCanLogin",
    membership.admin_option as "adminOption"
  from pg_catalog.pg_roles role
  left join pg_catalog.pg_auth_members membership on membership.roleid = role.oid
  left join pg_catalog.pg_roles member on member.oid = membership.member
  where role.rolname in ('product_suite_platform_runtime', 'product_suite_meeting_runtime')
`

function runtimeRoleCatalogSql(logins: readonly string[]): string {
  const quotedLogins = logins.map((login) => `'${login.replaceAll("'", "''")}'`).join(', ')
  return `${RUNTIME_ROLE_CATALOG_SQL.trimEnd()}\n    and member.rolname in (${quotedLogins})\n  order by role.rolname, member.rolname\n`
}

export interface RuntimePrivilegeProbeOptions {
  suffix?: string
  platformPassword?: string
  meetingPassword?: string
  createRuntimeSql?: (connectionUri: string) => Sql
}

export async function proveRuntimeLoginPrivileges(
  ownerSql: Sql,
  connectionUri: string,
  options: RuntimePrivilegeProbeOptions = {},
): Promise<void> {
  const suffix = options.suffix ?? randomUUID().replaceAll('-', '')
  const table = `runtime_privilege_probe_${suffix}`
  const sequence = `${table}_sequence`
  const deniedTable = `${table}_denied`
  const platformLogin = `platform_runtime_${suffix}`
  const meetingLogin = `meeting_runtime_${suffix}`
  const deniedRole = `${platformLogin}_denied`
  const platformPassword = options.platformPassword ?? randomBytes(24).toString('base64url')
  const meetingPassword = options.meetingPassword ?? randomBytes(24).toString('base64url')
  const createRuntimeClient = options.createRuntimeSql ?? createSql
  const tenantId = `runtime-tenant-${suffix}`
  const projectId = randomUUID()
  let probeFailed = false
  try {
    await exec(ownerSql, `create table public.${quoteIdentifier(table)} (id uuid primary key, value text not null)`)
    await exec(ownerSql, `create sequence public.${quoteIdentifier(sequence)}`)
    await exec(ownerSql, `create role ${quoteIdentifier(platformLogin)} login password '${platformPassword.replaceAll("'", "''")}' nosuperuser nocreatedb nocreaterole inherit`)
    await exec(ownerSql, `create role ${quoteIdentifier(meetingLogin)} login password '${meetingPassword.replaceAll("'", "''")}' nosuperuser nocreatedb nocreaterole inherit`)
    await exec(ownerSql, `grant ${quoteIdentifier('product_suite_platform_runtime')} to ${quoteIdentifier(platformLogin)}`)
    await exec(ownerSql, `grant ${quoteIdentifier('product_suite_meeting_runtime')} to ${quoteIdentifier(meetingLogin)}`)

    const roles = runtimeRoleSnapshotsFromCatalogRows(
      await query<RuntimeRoleCatalogRow>(ownerSql, runtimeRoleCatalogSql([platformLogin, meetingLogin])),
      { memberFilter: [platformLogin, meetingLogin] },
    )
    const roleEvidence = assertRuntimeRoleContract(roles, { allowedLogins: [platformLogin, meetingLogin] })
    if (roleEvidence.membershipCount !== 2) conformanceFailure('RUNTIME_LOGIN_MEMBERSHIP_UNPROVEN')

    const platformSql = createRuntimeClient(runtimeLoginUri(connectionUri, platformLogin, platformPassword))
    const meetingSql = createRuntimeClient(runtimeLoginUri(connectionUri, meetingLogin, meetingPassword))
    await exec(meetingSql, 'insert into public.tenants (id, slug, name) values ($1, $2, $3)', [tenantId, tenantId, 'runtime-probe'])
    const insertedTenant = await query<{ name: string }>(meetingSql, 'select name from public.tenants where id = $1', [tenantId])
    if (insertedTenant[0]?.name !== 'runtime-probe') conformanceFailure('RUNTIME_OWNED_CRUD_UNPROVEN')
    await exec(meetingSql, 'update public.tenants set name = $2 where id = $1', [tenantId, 'runtime-probe-updated'])
    const updatedTenant = await query<{ name: string }>(meetingSql, 'select name from public.tenants where id = $1', [tenantId])
    if (updatedTenant[0]?.name !== 'runtime-probe-updated') conformanceFailure('RUNTIME_OWNED_CRUD_UNPROVEN')

    await exec(platformSql, 'insert into public.projects (id, tenant_id, name) values ($1, $2, $3)', [projectId, tenantId, 'runtime-probe'])
    const insertedProject = await query<{ name: string }>(platformSql, 'select name from public.projects where id = $1', [projectId])
    if (insertedProject[0]?.name !== 'runtime-probe') conformanceFailure('RUNTIME_OWNED_CRUD_UNPROVEN')
    await exec(platformSql, 'update public.projects set name = $2 where id = $1', [projectId, 'runtime-probe-updated'])
    const updatedProject = await query<{ name: string }>(platformSql, 'select name from public.projects where id = $1', [projectId])
    if (updatedProject[0]?.name !== 'runtime-probe-updated') conformanceFailure('RUNTIME_OWNED_CRUD_UNPROVEN')
    await exec(platformSql, 'delete from public.projects where id = $1', [projectId])
    const deletedProject = await query<{ count: string }>(platformSql, 'select count(*)::text as count from public.projects where id = $1', [projectId])
    if (deletedProject[0]?.count !== '0') conformanceFailure('RUNTIME_OWNED_CRUD_UNPROVEN')
    await exec(meetingSql, 'delete from public.tenants where id = $1', [tenantId])
    const deletedTenant = await query<{ count: string }>(meetingSql, 'select count(*)::text as count from public.tenants where id = $1', [tenantId])
    if (deletedTenant[0]?.count !== '0') conformanceFailure('RUNTIME_OWNED_CRUD_UNPROVEN')

    // This table and sequence are deliberately outside both product-owned
    // manifests.  The negative probes prove an unlisted object cannot be read
    // or written through a runtime role, including sequence side channels.
    await expectPermissionDenied(() => exec(platformSql, `select * from public.${quoteIdentifier(table)}`))
    await expectPermissionDenied(() => exec(platformSql, `insert into public.${quoteIdentifier(table)} (id, value) values ($1, $2)`, [randomUUID(), 'probe']))
    await expectPermissionDenied(() => exec(platformSql, `select nextval('public.${quoteIdentifier(sequence)}')`))
    await expectPermissionDenied(() => exec(platformSql, `create table public.${quoteIdentifier(deniedTable)} (id integer)`))
    await expectPermissionDenied(() => exec(platformSql, `alter table public.${quoteIdentifier(table)} add column denied integer`))
    await expectPermissionDenied(() => exec(platformSql, `drop table public.${quoteIdentifier(table)}`))
    await expectPermissionDenied(() => exec(platformSql, `create role ${quoteIdentifier(deniedRole)} login`))
    await expectPermissionDenied(() => exec(platformSql, `set role ${quoteIdentifier('product_suite_meeting_runtime')}`))
    await expectPermissionDenied(() => exec(platformSql, 'select * from public.tenants'))
    await expectPermissionDenied(() => exec(meetingSql, 'select * from public.projects'))
  } catch (error) {
    probeFailed = true
    throw error
  } finally {
    let cleanupFailed = false
    const cleanup = async (operation: () => Promise<unknown>): Promise<void> => {
      try { await operation() } catch { cleanupFailed = true }
    }
    await cleanup(() => exec(ownerSql, 'delete from public.projects where id = $1', [projectId]))
    await cleanup(() => exec(ownerSql, 'delete from public.tenants where id = $1', [tenantId]))
    await cleanup(() => exec(ownerSql, `revoke ${quoteIdentifier('product_suite_platform_runtime')} from ${quoteIdentifier(platformLogin)}`))
    await cleanup(() => exec(ownerSql, `revoke ${quoteIdentifier('product_suite_meeting_runtime')} from ${quoteIdentifier(meetingLogin)}`))
    await cleanup(() => exec(ownerSql, `drop role if exists ${quoteIdentifier(platformLogin)}`))
    await cleanup(() => exec(ownerSql, `drop role if exists ${quoteIdentifier(meetingLogin)}`))
    await cleanup(() => exec(ownerSql, `drop role if exists ${quoteIdentifier(deniedRole)}`))
    await cleanup(() => exec(ownerSql, `drop sequence if exists public.${quoteIdentifier(sequence)}`))
    await cleanup(() => exec(ownerSql, `drop table if exists public.${quoteIdentifier(table)}`))
    await cleanup(() => exec(ownerSql, `drop table if exists public.${quoteIdentifier(deniedTable)}`))
    if (cleanupFailed && !probeFailed) conformanceFailure('RUNTIME_PROBE_CLEANUP_UNPROVEN')
  }
}

export async function withCanonicalDatabaseSession<T>(
  connectionUri: string,
  body: (adapter: SessionAdapter) => Promise<T>,
  poolFactory?: SessionPoolFactory,
): Promise<T> {
  try {
    return await withDatabaseSession(connectionUri, body, poolFactory)
  } catch (error) {
    if (error instanceof NeonConformanceError && isCanonicalBootstrapCode(error.code)) throw error
    throw new NeonConformanceError('DB_SESSION_UNPROVEN')
  }
}

export interface RealNeonConformanceEvidence {
  status: 'PASS' | 'INCOMPLETE'
  code?: string
  diagnostic?: ConformanceDiagnostic
  phase?: ConformancePhase
}

/** Accept only the single-field, redaction-safe success envelope. */
export function assertExactConformancePass(
  evidence: RealNeonConformanceEvidence,
): { status: 'PASS' } {
  if (evidence.status !== 'PASS' || Object.keys(evidence).length !== 1) {
    const hasStableCode = evidence.status === 'INCOMPLETE' && typeof evidence.code === 'string' && /^[A-Z0-9_]+$/.test(evidence.code)
    const code = hasStableCode
      ? evidence.code!
      : 'REAL_NEON_CONFORMANCE_REQUIRED'
    conformanceFailure(
      code,
      hasStableCode ? redactedConformanceDiagnostic(evidence.diagnostic) : undefined,
      hasStableCode ? redactedConformancePhase(evidence.phase) : undefined,
    )
  }
  return { status: 'PASS' }
}

/** Execute the real proof when the required lane explicitly requests it. */
export async function runRequiredNeonConformance(
  env: NeonControlPlaneEnv = process.env,
  controlPlane?: NeonControlPlane,
): Promise<RealNeonConformanceEvidence> {
  const credentials = conformanceCredentialStatus(env)
  if (credentials.status !== 'READY') {
    return { status: 'INCOMPLETE', code: credentials.code }
  }
  const plane = controlPlane ?? createNeonControlPlane(env)
  let disposable: NeonProjectHandle | undefined
  let derived: NeonDerivedHandle | undefined
  let evidence: RealNeonConformanceEvidence = { status: 'INCOMPLETE', code: 'REAL_NEON_CONFORMANCE_FAILED' }
  let phase: ConformancePhase = 'unknown'
  try {
    phase = 'disposable-create'
    disposable = await plane.createDisposableProject()
    phase = 'disposable-bootstrap'
    assertDisposableTestProject(disposable, env.NEON_PROJECT_ID!)
    await plane.proveVariant(disposable.connectionUri, 'repaired-bootstrap')
    phase = 'derived-create'
    derived = await plane.createProductionDerivedBranch()
    phase = 'derived-bootstrap'
    assertProductionDerivedBranch(derived)
    await plane.proveVariant(derived.connectionUri, 'original-production')
    phase = 'runtime-probe-disposable'
    await plane.probeLeastPrivilege(disposable.runtimeConnectionUri)
    phase = 'runtime-probe-derived'
    await plane.probeLeastPrivilege(derived.runtimeConnectionUri)
    evidence = { status: 'PASS' }
  } catch (error) {
    const fallbackCode = phase === 'disposable-bootstrap'
      ? 'DISPOSABLE_BOOTSTRAP_UNPROVEN'
      : 'REAL_NEON_CONFORMANCE_FAILED'
    evidence = {
      status: 'INCOMPLETE',
      code: error instanceof NeonConformanceError && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : fallbackCode,
      ...(error instanceof NeonConformanceError && error.diagnostic
        ? { diagnostic: redactedConformanceDiagnostic(error.diagnostic) }
        : {}),
      phase: redactedConformancePhase(phase) ?? 'unknown',
    }
  } finally {
    phase = 'cleanup'
    try {
      await plane.cleanupRetainedResources()
    } catch {
      if (evidence.status === 'PASS') {
        evidence = { status: 'INCOMPLETE', code: 'PROJECT_CLEANUP_UNPROVEN', phase: 'cleanup' }
      }
    }
  }
  return evidence
}

/** Validate an isolated, empty root project without returning identifiers. */
export function assertDisposableTestProject(
  project: DisposableTestProject,
  productionProjectId: string,
): DisposableTestProject {
  if (!project.projectId || project.projectId === productionProjectId) conformanceFailure('TEST_PROJECT_PRODUCTION_ID')
  if (project.database !== 'neondb') conformanceFailure('TEST_PROJECT_DATABASE_INVALID')
  if (project.authority !== 'test-only') conformanceFailure('TEST_PROJECT_AUTHORITY_INVALID')
  if (!project.branchIsRoot || !project.branchIsDefault) conformanceFailure('TEST_PROJECT_ROOT_REQUIRED')
  if (project.historyVariant !== 'repaired-bootstrap') conformanceFailure('TEST_PROJECT_VARIANT_INVALID')
  if (!Number.isInteger(project.catalogCount) || project.catalogCount !== 0) conformanceFailure('TEST_PROJECT_NOT_EMPTY')
  return project
}

/** Validate that the original-history proof uses a non-root production-derived branch. */
export function assertProductionDerivedBranch(branch: ProductionDerivedBranch): ProductionDerivedBranch {
  if (!branch.projectId || !branch.productionProjectId || branch.projectId !== branch.productionProjectId) {
    conformanceFailure('PRODUCTION_DERIVED_PROJECT_MISMATCH')
  }
  if (!branch.parentBranchId) conformanceFailure('PRODUCTION_DERIVED_PARENT_REQUIRED')
  if (branch.branchIsRoot || branch.branchIsDefault) conformanceFailure('PRODUCTION_DERIVED_ROOT')
  if (branch.authority !== 'production-derived') conformanceFailure('PRODUCTION_DERIVED_AUTHORITY_INVALID')
  if (branch.historyVariant !== 'original-production') conformanceFailure('PRODUCTION_DERIVED_VARIANT_INVALID')
  return branch
}

/** Require a complete create/bootstrap/verify/delete/deletion-proof sequence. */
export function assertCleanupEvidence(evidence: CleanupEvidence): { status: 'PASS' } {
  if (!evidence.projectCreated) conformanceFailure('PROJECT_CREATE_REQUIRED')
  if (!evidence.repairedBootstrapVerified) conformanceFailure('REPAIRED_BOOTSTRAP_UNPROVEN')
  if (!evidence.productionDerivedBranchVerified) conformanceFailure('PRODUCTION_DERIVED_UNPROVEN')
  if (!evidence.branchDeleteRequested) conformanceFailure('BRANCH_CLEANUP_REQUIRED')
  if (!evidence.branchDeletionVerified) conformanceFailure('BRANCH_DELETION_UNPROVEN')
  if (!evidence.projectDeleteRequested) conformanceFailure('PROJECT_CLEANUP_REQUIRED')
  if (!evidence.projectDeletionVerified) conformanceFailure('PROJECT_DELETION_UNPROVEN')
  return { status: 'PASS' }
}

export interface RuntimeRoleMembership {
  member: string
  adminOption: boolean
}

export interface RuntimeRoleSnapshot {
  name: string
  canLogin: boolean
  isSuperuser: boolean
  canCreateRole: boolean
  canCreateDb: boolean
  memberships: RuntimeRoleMembership[]
}

export interface RuntimeRoleCatalogRow {
  name: string
  canLogin: boolean
  isSuperuser: boolean
  canCreateRole: boolean
  canCreateDb: boolean
  member: string | null
  memberCanLogin: boolean | null
  adminOption: boolean | null
}

const RUNTIME_ROLE_NAMES = ['product_suite_platform_runtime', 'product_suite_meeting_runtime'] as const

/** Aggregate real pg_catalog membership rows into the opaque role contract. */
export function runtimeRoleSnapshotsFromCatalogRows(
  rows: RuntimeRoleCatalogRow[],
  options: { memberFilter?: readonly string[] } = {},
): RuntimeRoleSnapshot[] {
  const roles = new Map<string, RuntimeRoleSnapshot>()
  const memberFilter = options.memberFilter ? new Set(options.memberFilter) : undefined
  for (const row of rows) {
    const role = roles.get(row.name) ?? {
      name: row.name,
      canLogin: row.canLogin,
      isSuperuser: row.isSuperuser,
      canCreateRole: row.canCreateRole,
      canCreateDb: row.canCreateDb,
      memberships: [],
    }
    if (row.member && (!memberFilter || memberFilter.has(row.member))) {
      if (row.memberCanLogin !== true) conformanceFailure('RUNTIME_MEMBER_MUST_BE_LOGIN')
      role.memberships.push({ member: row.member, adminOption: row.adminOption === true })
    }
    roles.set(row.name, role)
  }
  return RUNTIME_ROLE_NAMES.flatMap((name) => {
    const role = roles.get(name)
    return role ? [role] : []
  })
}

/**
 * Validate the exact pre-0019 least-privilege contract without exposing role
 * names, membership rows, connection URLs, or query errors in the result.
 */
export function assertRuntimeRoleContract(
  roles: RuntimeRoleSnapshot[],
  options: { allowedLogins?: readonly string[] } = {},
): { status: 'READY'; roleCount: number; membershipCount: number } {
  const byName = new Map(roles.map((role) => [role.name, role]))
  const allowed = new Set(options.allowedLogins ?? ['platform_runtime_login', 'meeting_runtime_login'])
  let membershipCount = 0

  for (const required of RUNTIME_ROLE_NAMES) {
    const role = byName.get(required)
    if (!role) conformanceFailure('RUNTIME_ROLE_MISSING')
    if (role.canLogin) conformanceFailure('RUNTIME_ROLE_MUST_BE_NOLOGIN')
    if (role.isSuperuser || role.canCreateRole || role.canCreateDb) conformanceFailure('RUNTIME_ROLE_ESCALATION')

    for (const membership of role.memberships) {
      membershipCount += 1
      if (!allowed.has(membership.member)) conformanceFailure('RUNTIME_LOGIN_UNAUTHORIZED')
      if (membership.adminOption) conformanceFailure('RUNTIME_ROLE_ADMIN_OPTION_FORBIDDEN')
      const isPlatformRole = required.includes('platform')
      const isMeetingRole = required.includes('meeting')
      if ((isPlatformRole && membership.member.includes('meeting')) || (isMeetingRole && membership.member.includes('platform'))) {
        conformanceFailure('RUNTIME_ROLE_CROSS_SERVICE_MEMBERSHIP')
      }
    }
  }

  return { status: 'READY', roleCount: RUNTIME_ROLE_NAMES.length, membershipCount }
}

/** Probe names are intentionally semantic and contain no authored SQL payloads. */
export function buildRuntimePrivilegeProbes(): {
  allowed: readonly ['service_login_membership', 'owned_table_crud']
  denied: readonly ['unlisted_table', 'unlisted_sequence', 'ddl', 'role_escalation', 'set_role', 'cross_service_table']
} {
  return {
    allowed: ['service_login_membership', 'owned_table_crud'],
    denied: ['unlisted_table', 'unlisted_sequence', 'ddl', 'role_escalation', 'set_role', 'cross_service_table'],
  }
}

/**
 * The seven canonical workflow statuses every team gets (mirrors the default set
 * seeded in migration 0002). `Backlog` is the create-time DEFAULT — the lowest
 * `position` whose category is not `triage` (see `resolveDefaultStatusId`), so
 * `seed.defaultStatusId === seed.statusIds.Backlog`.
 */
const STATUS_SEED = [
  { name: 'Triage', category: 'triage', position: 0 },
  { name: 'Backlog', category: 'backlog', position: 1 },
  { name: 'Todo', category: 'unstarted', position: 2 },
  { name: 'In Progress', category: 'started', position: 3 },
  { name: 'In Review', category: 'started', position: 4 },
  { name: 'Done', category: 'completed', position: 5 },
  { name: 'Canceled', category: 'canceled', position: 6 },
] as const

export type StatusName = (typeof STATUS_SEED)[number]['name']

/**
 * The baseline fixture every contract test starts from: exactly ONE tenant with
 * ONE team, the seven default statuses, one user (the approver), and one agent run
 * (proposals must be attributable to a run). Ids are the real DB ids — pass them
 * straight into `createProposal`/`applyProposal`.
 */
export interface Seed {
  /** The org / workspace / tenant id (a `text` id, matching `tenants.id`). */
  tenantId: string
  /** The sole team in `tenantId` (so a create can default its team). */
  teamId: string
  /** A platform user id — the approver on accept, and a valid `assignee_id`. */
  userId: string
  /** An `agent_runs` id — the attributable actor a proposal's `run_id` points at. */
  runId: string
  /** The seven team statuses, keyed by name. */
  statusIds: Record<StatusName, string>
  /** The status a create with no `status_id` resolves to (= `statusIds.Backlog`). */
  defaultStatusId: string
}

/** What the test body receives. */
export interface DbBranchContext {
  /** Drizzle neon-http client (query builder), bound to the ephemeral branch. */
  db: Database
  /** Raw neon tagged-template client — what the domain/accept commands consume. */
  sql: Sql
  /** The seeded baseline ids. */
  seed: Seed
  /** The ephemeral branch id (for diagnostics; deleted automatically). */
  branchId: string
}

// This file lives at apps/platform-api/test/db-contract/harness.ts; the migrations
// live at packages/db/migrations. Resolve relative to THIS file so the path holds
// regardless of the process cwd vitest runs under.
const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(HERE, '../../../../packages/db/migrations')

interface JournalEntry {
  idx: number
  tag: string
}

/** Run a single parameterized statement via neon's `sql.query(text, params)` (v1.x). */
async function exec(sql: Sql, text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (sql as unknown as {
    query: (q: string, p: unknown[]) => Promise<Record<string, unknown>[]>
  }).query(text, params)
}

/** Read + execute rows for a select — exported so contract tests can assert on the DB. */
export async function query<Row = Record<string, unknown>>(
  sql: Sql,
  text: string,
  params: unknown[] = [],
): Promise<Row[]> {
  return exec(sql, text, params) as unknown as Promise<Row[]>
}

/**
 * Apply the complete migration chain to a fresh branch, exactly as `drizzle-kit
 * migrate` would: walk `meta/_journal.json` in `idx` order and execute each
 * migration file's statements (split on drizzle's `--> statement-breakpoint`, the
 * separator it guarantees between top-level statements). The neon-http driver runs
 * one statement per round-trip and has no multi-statement transactions, so each
 * statement is executed individually — the same way the migrator does over HTTP.
 *
 * Bootstrap first: repaired historical migrations conditionally add FKs to
 * canonical identity tables. The harness creates canonical test-only identity
 * tables before replay so it exercises the pre-existing-FK reconciliation path.
 */
async function applyHarnessMigrations(sql: Sql, options: { recordJournal?: boolean } = {}): Promise<void> {
  // Start from a pristine schema so the tier is PARENT-AGNOSTIC: the branch may be
  // cloned from an empty root OR from a populated production branch (which already
  // has these tables + data), and a contract test must depend on neither. Resetting
  // `public` guarantees migration 0000 runs against an empty schema every time — the
  // literal "fresh branch" test 10 asserts. Safe because the branch is ephemeral and
  // isolated (deleted in teardown); it never touches the parent.
  await exec(sql, `drop schema if exists public cascade`)
  await exec(sql, `create schema public`)

  // Canonical test-only identity tables the FKs reference. Their shape must
  // match the 0019 catalog contract exactly:
  // migration assertions run after these tables exist, before the suite seeds
  // any rows. Keep this test-only DDL aligned with the 0019 canonical catalog contract.
  await exec(sql, `
    create table if not exists tenants (
      id text primary key,
      slug text not null,
      name text not null,
      created_at timestamp with time zone not null default now(),
      updated_at timestamp with time zone not null default now(),
      constraint tenants_slug_key unique (slug)
    )
  `)
  await exec(sql, `
    create table if not exists users (
      id text primary key,
      email text not null,
      password_hash text not null,
      name text,
      created_at timestamp with time zone not null,
      updated_at timestamp with time zone not null,
      constraint users_email_key unique (email)
    )
  `)
  await exec(sql, `create index if not exists idx_users_email on public.users using btree (lower("email"))`)

  if (options.recordJournal) {
    await exec(sql, `create schema if not exists drizzle`)
    await exec(sql, `create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint not null)`)
    await exec(sql, `truncate table drizzle.__drizzle_migrations`)
  }

  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] }
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx)

  for (const entry of ordered) {
    const file = readFileSync(resolve(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8')
    const statements = file
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const statement of statements) {
      await exec(sql, statement)
    }
    if (options.recordJournal) {
      const hash = createHash('sha256').update(file.replace(/\r\n?/g, '\n'), 'utf8').digest('hex')
      await exec(sql, `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, [hash, entry.idx])
    }
  }
}

export interface HarnessDatabaseSetup {
  provisionRoles(connectionUri: string): Promise<void>
  applyMigrations(sql: Sql): Promise<void>
}

async function provisionHarnessRoles(connectionUri: string): Promise<void> {
  // @ts-expect-error Canonical JavaScript provisioner has no declaration file; its surface is narrowed here.
  const roleProvisioner = await import('../../../../scripts/provision-database-roles.mjs') as {
    provisionDatabaseRoles(input: Record<string, unknown>): Promise<CanonicalEvidence>
  }
  await withDatabaseSession(connectionUri, async (adapter) => {
    const evidence = await roleProvisioner.provisionDatabaseRoles({
      adapter,
      databaseUrl: connectionUri,
      environment: 'test',
    })
    if (!evidence.ok) conformanceFailure('RUNTIME_ROLE_PROVISION_UNPROVEN')
  })
}

const canonicalHarnessDatabaseSetup: HarnessDatabaseSetup = {
  provisionRoles: provisionHarnessRoles,
  applyMigrations: applyHarnessMigrations,
}

export async function prepareHarnessDatabase(
  connectionUri: string,
  sql: Sql,
  setup: HarnessDatabaseSetup = canonicalHarnessDatabaseSetup,
): Promise<void> {
  await setup.provisionRoles(connectionUri)
  await setup.applyMigrations(sql)
}

/** Seed the baseline fixture and return its ids. */
export async function seedBaseline(sql: Sql): Promise<Seed> {
  const tenantId = randomUUID()
  const userId = randomUUID()
  const teamId = randomUUID()
  const runId = randomUUID()

  await exec(sql, `insert into tenants (id, slug, name) values ($1, $2, $3)`, [
    tenantId,
    `contract-${tenantId}`,
    'Contract Test Org',
  ])
  await exec(sql, `
    insert into users (id, email, password_hash, name, created_at, updated_at)
    values ($1, $2, $3, $4, now(), now())
  `, [userId, 'contract@test.local', 'test-password-hash', 'Contract User'])
  await exec(sql, `insert into teams (id, tenant_id, name) values ($1, $2, $3)`, [
    teamId,
    tenantId,
    'Contract Team',
  ])
  await exec(
    sql,
    `insert into agent_runs (id, tenant_id, triggered_by, kind, status) values ($1, $2, $3, 'agent_run', 'running')`,
    [runId, tenantId, userId],
  )

  const statusIds = {} as Record<StatusName, string>
  for (const s of STATUS_SEED) {
    const id = randomUUID()
    await exec(
      sql,
      `insert into statuses (id, team_id, name, category, position) values ($1, $2, $3, $4, $5)`,
      [id, teamId, s.name, s.category, s.position],
    )
    statusIds[s.name] = id
  }

  return { tenantId, teamId, userId, runId, statusIds, defaultStatusId: statusIds.Backlog }
}

/**
 * Provision an ephemeral Neon branch, migrate + seed it, run `body`, and ALWAYS
 * delete the branch — even if the body throws. The branch is fully isolated, so
 * tests never contend for shared rows and teardown is a single API call.
 */
export async function withDedicatedDbBranch<T>(body: (ctx: DbBranchContext) => Promise<T>): Promise<T> {
  const runtime = workerRuntimeConfig()
  const lease = await createBranchLeaseCoordinator({
    runToken: runtime.runToken,
    rootDir: runtime.leaseRoot,
  }).acquire('dedicated')
  let created: EphemeralBranch
  try {
    created = await createEphemeralBranch()
  } catch (error) {
    await handleDedicatedCreateFailure(error, lease)
  }
  const { branchId, connectionUri } = created!
  let value: T | undefined
  let primary: unknown
  let hasPrimary = false
  try {
    const sql = createSql(connectionUri)
    const db = createDb(connectionUri)
    await prepareHarnessDatabase(connectionUri, sql)
    const seed = await seedBaseline(sql)
    value = await body({ db, sql, seed, branchId })
  } catch (error) {
    primary = error
    hasPrimary = true
  }
  await finishDedicatedBranchLifecycle(branchId, lease, primary, hasPrimary)
  return value as T
}

export async function handleDedicatedCreateFailure(error: unknown, lease: BranchLease): Promise<never> {
  if (error instanceof NeonBranchError && error.absenceProven) {
    try {
      await lease.release()
    } catch {
      throw new AggregateError([
        error,
        new NeonBranchError('DB_CONTRACT_BRANCH_LEASE_RELEASE_UNPROVEN'),
      ], 'DB_CONTRACT_TEST_AND_CLEANUP_FAILED')
    }
  }
  throw error
}

export async function finishDedicatedBranchLifecycle(
  branchId: string,
  lease: BranchLease,
  primary: unknown,
  hasPrimary: boolean,
  deleteBranch: (branchId: string) => Promise<void> = deleteEphemeralBranchStrict,
): Promise<void> {
  let cleanup: NeonBranchError | NeonConformanceError | undefined
  try {
    await deleteBranch(branchId)
  } catch (error) {
    cleanup = dedicatedCleanupFailure(error)
  }
  if (!cleanup) {
    try {
      await lease.release()
    } catch {
      cleanup = new NeonBranchError('DB_CONTRACT_BRANCH_LEASE_RELEASE_UNPROVEN')
    }
  }
  if (hasPrimary && cleanup) {
    throw new AggregateError([primary, cleanup], 'DB_CONTRACT_TEST_AND_CLEANUP_FAILED')
  }
  if (hasPrimary) throw primary
  if (cleanup) throw cleanup
}

/** Preserve the strict control-plane code while discarding unknown cleanup details. */
export function dedicatedCleanupFailure(error: unknown): NeonBranchError | NeonConformanceError {
  return error instanceof NeonBranchError
    ? error
    : new NeonConformanceError('BRANCH_DELETION_UNPROVEN')
}

/** Compatibility alias; topology routing moves callers to the explicit helper in A4. */
export const withDbBranch = withDedicatedDbBranch
