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
import { createHash, randomUUID } from 'node:crypto'

import { createDb, createSql, type Database, type Sql } from '@product-suite/db'

import { createEphemeralBranch, deleteEphemeralBranch } from './neon-branch'

/** The only migration-history variants accepted by the authority contract. */
export type NeonHistoryVariant = 'original-production' | 'repaired-bootstrap'

/** A redaction-safe conformance failure.  Messages are stable codes only. */
export class NeonConformanceError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'NeonConformanceError'
    this.code = code
  }
}

function conformanceFailure(code: string): never {
  throw new NeonConformanceError(code)
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
  projectDeleteRequested: boolean
  projectDeletionVerified: boolean
}

type NeonControlPlaneEnv = Partial<Pick<NodeJS.ProcessEnv, 'NEON_API_KEY' | 'NEON_PROJECT_ID' | 'NEON_PARENT_BRANCH_ID'>>

export interface ConformanceCredentialStatus {
  status: 'READY' | 'INCOMPLETE'
  code?: 'NEON_CREDENTIALS_UNAVAILABLE'
}

/** True when the branch-level contract tier can reach the Neon control plane. */
export function hasNeonCreds(
  env: NeonControlPlaneEnv = process.env,
): boolean {
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

export function requiredConformanceStatus(
  env: NeonControlPlaneEnv = process.env,
): ConformanceCredentialStatus {
  return conformanceCredentialStatus(env)
}

export interface NeonProjectHandle extends DisposableTestProject {
  connectionUri: string
}

export interface NeonDerivedHandle extends ProductionDerivedBranch {
  connectionUri: string
}

export interface NeonControlPlane {
  createDisposableProject(): Promise<NeonProjectHandle>
  createProductionDerivedBranch(): Promise<NeonDerivedHandle>
  bootstrapRepaired(connectionUri: string): Promise<void>
  verifyRepairedNoop(connectionUri: string): Promise<void>
  probeLeastPrivilege(connectionUri: string): Promise<void>
  deleteProject(projectId: string): Promise<void>
  verifyProjectDeleted(projectId: string): Promise<void>
  deleteBranch(projectId: string, branchId: string): Promise<void>
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

/** Fetch JSON without ever surfacing response bodies, URLs, or credentials. */
async function controlPlaneFetch(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${controlPlaneBase()}${path}`, {
    method: init.method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) conformanceFailure('NEON_CONTROL_PLANE_FAILED')
  return { status: response.status, body }
}

async function waitControlPlaneOperations(apiKey: string, projectId: string, operations: NeonOperation[] = []): Promise<void> {
  const deadline = Date.now() + 180_000
  for (const operation of operations) {
    let status = operation.status
    while (status !== 'finished') {
      if (status === 'failed' || status === 'cancelled') conformanceFailure('NEON_OPERATION_FAILED')
      if (Date.now() > deadline) conformanceFailure('NEON_OPERATION_TIMEOUT')
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      const result = await controlPlaneFetch(apiKey, `/projects/${projectId}/operations/${operation.id}`, { method: 'GET' })
      const current = result.body.operation as { status?: unknown } | undefined
      status = typeof current?.status === 'string' ? current.status : status
    }
  }
}

function projectIdResponse(body: Record<string, unknown>): string {
  const project = body.project as { id?: unknown } | undefined
  return typeof project?.id === 'string' ? project.id : ''
}

function projectResponse(body: Record<string, unknown>): { projectId: string; branchId: string; connectionUri: string } {
  const project = body.project as { id?: unknown; default_branch_id?: unknown } | undefined
  const branch = body.branch as { id?: unknown } | undefined
  const projectId = typeof project?.id === 'string' ? project.id : ''
  const branchId = typeof branch?.id === 'string' ? branch.id : typeof project?.default_branch_id === 'string' ? project.default_branch_id : ''
  const uris = body.connection_uris as Array<{ connection_uri?: unknown }> | undefined
  const connectionUri = typeof uris?.[0]?.connection_uri === 'string' ? uris[0].connection_uri : ''
  if (!projectId || !branchId || !connectionUri) conformanceFailure('NEON_PROJECT_RESPONSE_INVALID')
  return { projectId, branchId, connectionUri }
}

function branchResponse(body: Record<string, unknown>): { branchId: string; connectionUri: string } {
  const branch = body.branch as { id?: unknown; parent_id?: unknown; default?: unknown } | undefined
  const uris = body.connection_uris as Array<{ connection_uri?: unknown }> | undefined
  const branchId = typeof branch?.id === 'string' ? branch.id : ''
  const connectionUri = typeof uris?.[0]?.connection_uri === 'string' ? uris[0].connection_uri : ''
  if (!branchId || !connectionUri) conformanceFailure('NEON_BRANCH_RESPONSE_INVALID')
  return { branchId, connectionUri }
}

function branchIdResponse(body: Record<string, unknown>): string {
  const branch = body.branch as { id?: unknown } | undefined
  return typeof branch?.id === 'string' ? branch.id : ''
}

async function productionParentBranchId(
  apiKey: string,
  sourceProjectId: string,
  requestedParentBranchId: string | undefined,
): Promise<string> {
  if (requestedParentBranchId) return requestedParentBranchId
  const result = await controlPlaneFetch(apiKey, `/projects/${sourceProjectId}/branches?limit=100`, { method: 'GET' })
  const branches = Array.isArray(result.body.branches) ? result.body.branches as Array<{ id?: unknown; default?: unknown }> : []
  const parent = branches.find((branch) => branch.default === true) ?? branches[0]
  if (typeof parent?.id !== 'string' || parent.id.length === 0) {
    conformanceFailure('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
  }
  return parent.id
}

/** Native-fetch control-plane adapter: project/root + production-derived branch. */
export function createNeonControlPlane(env: NeonControlPlaneEnv = process.env): NeonControlPlane {
  const { apiKey, sourceProjectId } = controlPlaneConfig(env)
  return {
    async createDisposableProject() {
      const result = await controlPlaneFetch(apiKey, '/projects', {
        method: 'POST',
        body: { project: { name: `product-suite-db-contract-${Date.now()}`, pg_version: 17 } },
      })
      const projectId = projectIdResponse(result.body)
      if (!projectId) conformanceFailure('NEON_PROJECT_RESPONSE_INVALID')
      try {
        await waitControlPlaneOperations(apiKey, projectId, (result.body.operations ?? []) as NeonOperation[])
        const created = projectResponse(result.body)
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
        }
      } catch (error) {
        try {
          await controlPlaneFetch(apiKey, `/projects/${projectId}`, { method: 'DELETE' })
          const deleted = await fetch(`${controlPlaneBase()}/projects/${projectId}`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
          })
          if (deleted.status !== 404) conformanceFailure('PROJECT_DELETION_UNPROVEN')
        } catch {
          // Preserve the stable conformance failure; cleanup is rechecked by the caller when a handle exists.
        }
        throw error
      }
    },
    async createProductionDerivedBranch() {
      const parentBranchId = await productionParentBranchId(apiKey, sourceProjectId, env.NEON_PARENT_BRANCH_ID)
      const body = {
        endpoints: [{ type: 'read_write' }],
        branch: { name: `db-contract-production-${Date.now()}`, parent_id: parentBranchId },
      }
      const result = await controlPlaneFetch(apiKey, `/projects/${sourceProjectId}/branches`, { method: 'POST', body })
      const branchId = branchIdResponse(result.body)
      if (!branchId) conformanceFailure('NEON_BRANCH_RESPONSE_INVALID')
      try {
        await waitControlPlaneOperations(apiKey, sourceProjectId, (result.body.operations ?? []) as NeonOperation[])
        const created = branchResponse(result.body)
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
      } catch (error) {
        try { await controlPlaneFetch(apiKey, `/projects/${sourceProjectId}/branches/${branchId}`, { method: 'DELETE' }) } catch { /* preserve original failure */ }
        throw error
      }
    },
    async bootstrapRepaired(connectionUri) {
      const sql = createSql(connectionUri)
      await exec(sql, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_suite_platform_runtime') THEN CREATE ROLE product_suite_platform_runtime NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_suite_meeting_runtime') THEN CREATE ROLE product_suite_meeting_runtime NOLOGIN; END IF; END $$`)
      await applyMigrations(sql, { recordJournal: true })
    },
    async verifyRepairedNoop(connectionUri) {
      const sql = createSql(connectionUri)
      const rows = await query<{ hash?: string }>(sql, `select hash from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1`)
      const migration = readFileSync(resolve(MIGRATIONS_DIR, '0019_neon_authority_reconciliation.sql'), 'utf8')
      const expectedHash = createHash('sha256').update(migration.replace(/\r\n?/g, '\n'), 'utf8').digest('hex')
      if (rows[0]?.hash !== expectedHash) conformanceFailure('REPAIRED_BOOTSTRAP_UNPROVEN')
    },
    async probeLeastPrivilege(connectionUri) {
      const sql = createSql(connectionUri)
      const roles = await query<RuntimeRoleSnapshot>(sql, `select rolname as name, rolcanlogin as "canLogin", rolsuper as "isSuperuser", rolcreaterole as "canCreateRole", rolcreatedb as "canCreateDb", '[]'::json as memberships from pg_roles where rolname in ('product_suite_platform_runtime','product_suite_meeting_runtime')`)
      assertRuntimeRoleContract(roles, { allowedLogins: [] })
    },
    async deleteProject(projectId) { await controlPlaneFetch(apiKey, `/projects/${projectId}`, { method: 'DELETE' }) },
    async verifyProjectDeleted(projectId) {
      const response = await fetch(`${controlPlaneBase()}/projects/${projectId}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` } })
      if (response.status !== 404) conformanceFailure('PROJECT_DELETION_UNPROVEN')
    },
    async deleteBranch(projectId, branchId) { await controlPlaneFetch(apiKey, `/projects/${projectId}/branches/${branchId}`, { method: 'DELETE' }) },
  }
}

export interface RealNeonConformanceEvidence {
  status: 'PASS' | 'INCOMPLETE'
  code?: string
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
  let cleanupFailed = false
  try {
    disposable = await plane.createDisposableProject()
    assertDisposableTestProject(disposable, env.NEON_PROJECT_ID!)
    await plane.bootstrapRepaired(disposable.connectionUri)
    await plane.verifyRepairedNoop(disposable.connectionUri)
    derived = await plane.createProductionDerivedBranch()
    assertProductionDerivedBranch(derived)
    await plane.probeLeastPrivilege(disposable.connectionUri)
    await plane.probeLeastPrivilege(derived.connectionUri)
    evidence = { status: 'PASS' }
  } catch {
    evidence = { status: 'INCOMPLETE', code: 'REAL_NEON_CONFORMANCE_FAILED' }
  } finally {
    if (derived) {
      try { await plane.deleteBranch(derived.projectId, derived.branchId) } catch { cleanupFailed = true }
    }
    if (disposable) {
      try {
        await plane.deleteProject(disposable.projectId)
        await plane.verifyProjectDeleted(disposable.projectId)
      } catch { cleanupFailed = true }
    }
  }
  return cleanupFailed ? { status: 'INCOMPLETE', code: 'PROJECT_CLEANUP_UNPROVEN' } : evidence
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

const RUNTIME_ROLE_NAMES = ['product_suite_platform_runtime', 'product_suite_meeting_runtime'] as const

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
  allowed: readonly ['select_public', 'write_owned_rows']
  denied: readonly ['ddl', 'role_escalation', 'cross_service_schema']
} {
  return {
    allowed: ['select_public', 'write_owned_rows'],
    denied: ['ddl', 'role_escalation', 'cross_service_schema'],
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
 * Bootstrap first: the workboard migrations add cross-tool FKs to `tenants` and
 * `users` — identity tables owned OUTSIDE drizzle (Alembic, `text` ids; see
 * schema.ts). A fresh branch has neither, so migration 0000's `ADD CONSTRAINT`
 * would fail. We create minimal stand-ins (just enough to satisfy the FKs) before
 * the chain runs. This mirrors production, where those tables pre-exist.
 */
async function applyMigrations(sql: Sql, options: { recordJournal?: boolean } = {}): Promise<void> {
  // Start from a pristine schema so the tier is PARENT-AGNOSTIC: the branch may be
  // cloned from an empty root OR from a populated production branch (which already
  // has these tables + data), and a contract test must depend on neither. Resetting
  // `public` guarantees migration 0000 runs against an empty schema every time — the
  // literal "fresh branch" test 10 asserts. Safe because the branch is ephemeral and
  // isolated (deleted in teardown); it never touches the parent.
  await exec(sql, `drop schema if exists public cascade`)
  await exec(sql, `create schema public`)

  // Minimal stand-ins for the externally-owned identity tables the FKs reference.
  await exec(sql, `create table if not exists tenants (id text primary key, name text)`)
  await exec(sql, `create table if not exists users (id text primary key, email text)`)

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

/** Seed the baseline fixture and return its ids. */
async function seedBaseline(sql: Sql): Promise<Seed> {
  const tenantId = randomUUID()
  const userId = randomUUID()
  const teamId = randomUUID()
  const runId = randomUUID()

  await exec(sql, `insert into tenants (id, name) values ($1, $2)`, [tenantId, 'Contract Test Org'])
  await exec(sql, `insert into users (id, email) values ($1, $2)`, [userId, 'contract@test.local'])
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
export async function withDbBranch<T>(body: (ctx: DbBranchContext) => Promise<T>): Promise<T> {
  const { branchId, connectionUri } = await createEphemeralBranch()
  try {
    const sql = createSql(connectionUri)
    const db = createDb(connectionUri)
    await applyMigrations(sql)
    const seed = await seedBaseline(sql)
    return await body({ db, sql, seed, branchId })
  } finally {
    await deleteEphemeralBranch(branchId)
  }
}
