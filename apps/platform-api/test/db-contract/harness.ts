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
import { randomUUID } from 'node:crypto'

import { createDb, createSql, type Database, type Sql } from '@product-suite/db'

import { createEphemeralBranch, deleteEphemeralBranch } from './neon-branch'

/** True when the Neon control-plane creds needed to run this tier are present. */
export function hasNeonCreds(): boolean {
  return Boolean(process.env.NEON_API_KEY && process.env.NEON_PROJECT_ID)
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
async function applyMigrations(sql: Sql): Promise<void> {
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
