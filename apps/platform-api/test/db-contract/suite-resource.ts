import { Pool } from '@neondatabase/serverless'
import { createSql, type Sql } from '@product-suite/db'
import { afterAll, beforeAll } from 'vitest'

import { prepareHarnessDatabase, seedBaseline, type Seed } from './harness'
import { createEphemeralBranch, deleteEphemeralBranchStrict, suiteBranchPrefix, type EphemeralBranch } from './neon-branch'
import { createTransactionSql, type PinnedPoolClient, type TransactionSql } from './transaction-sql'
import { measurePhase, telemetryPathFromEnv, type TelemetryPhase } from './telemetry'

export { withDedicatedDbBranch } from './harness'

export class SuiteResourceError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'SuiteResourceError'
    this.code = code
  }
}

interface TransactionClient extends PinnedPoolClient {
  release(): void | Promise<void>
}

interface PinnedPool {
  connect(): Promise<TransactionClient>
  end(): Promise<void>
}

export interface TransactionalDbContext {
  sql: TransactionSql
  seed: Seed
  diagnostics: Readonly<{ topology: 'transactional-suite' }>
}

export interface TransactionalDbDependencies {
  registerBeforeAll(hook: () => Promise<void>): void
  registerAfterAll(hook: () => Promise<void>): void
  branchPrefix(suiteName: string): string
  createBranch(namePrefix: string): Promise<EphemeralBranch>
  prepare(connectionUri: string): Promise<void>
  connect(connectionUri: string): Promise<TransactionClient>
  transactionSql(client: PinnedPoolClient): TransactionSql
  seed(sql: TransactionSql): Promise<Seed>
  observeSentinelAbsent(connectionUri: string, tenantId: string): Promise<void>
  deleteBranch(branchId: string): Promise<void>
  measure?<T>(phase: TelemetryPhase, operation: () => Promise<T>): Promise<T>
}

export async function connectPinnedForTest(
  connectionUri: string,
  createPool: (connectionUri: string) => PinnedPool = (uri) => new Pool({
    connectionString: uri,
    max: 1,
  }) as unknown as PinnedPool,
): Promise<TransactionClient> {
  const pool = createPool(connectionUri)
  let client: TransactionClient
  try {
    client = await pool.connect()
  } catch {
    const primary = stableCleanupError('DB_CONTRACT_SESSION_CONNECT_FAILED')
    try {
      await pool.end()
    } catch {
      throwCombined(primary, true, [stableCleanupError('DB_CONTRACT_POOL_CLOSE_UNPROVEN')])
    }
    throw primary
  }
  return {
    query: client.query.bind(client),
    release: async () => {
      client.release()
      await pool.end()
    },
  }
}

async function observeSentinelAbsent(connectionUri: string, tenantId: string): Promise<void> {
  const sql = createSql(connectionUri)
  const rows = await (sql as unknown as {
    query(text: string, params: unknown[]): Promise<Array<{ count: number | string }>>
  }).query('select count(*)::int as count from tenants where id = $1', [tenantId])
  if (Number(rows[0]?.count ?? 0) !== 0) {
    throw new SuiteResourceError('DB_CONTRACT_SENTINEL_LEAK_DETECTED')
  }
}

const defaultDependencies: TransactionalDbDependencies = {
  registerBeforeAll: beforeAll,
  registerAfterAll: afterAll,
  branchPrefix: suiteBranchPrefix,
  createBranch: createEphemeralBranch,
  prepare: async (connectionUri) => {
    const sql = createSql(connectionUri)
    await prepareHarnessDatabase(connectionUri, sql)
  },
  connect: connectPinnedForTest,
  transactionSql: createTransactionSql,
  seed: async (sql) => seedBaseline(sql as unknown as Sql),
  observeSentinelAbsent,
  deleteBranch: deleteEphemeralBranchStrict,
  measure: (phase, operation) => measurePhase(telemetryPathFromEnv(), phase, operation),
}

function stableCleanupError(code: string): SuiteResourceError {
  return new SuiteResourceError(code)
}

function throwCombined(primary: unknown, hasPrimary: boolean, cleanup: SuiteResourceError[]): never {
  if (hasPrimary && cleanup.length === 0) throw primary
  if (!hasPrimary && cleanup.length === 1) throw cleanup[0]
  const errors = hasPrimary ? [primary, ...cleanup] : cleanup
  throw new AggregateError(errors, 'DB_CONTRACT_TEST_AND_CLEANUP_FAILED')
}

export type TransactionalDbRunner = <T>(body: (context: TransactionalDbContext) => Promise<T>) => Promise<T>

/** Register one migrated branch for the current suite and wrap each test in rollback isolation. */
export function createTransactionalDbSuite(
  suiteName: string,
  dependencies: TransactionalDbDependencies = defaultDependencies,
): TransactionalDbRunner {
  let branch: EphemeralBranch | undefined
  const measured = <T>(phase: TelemetryPhase, operation: () => Promise<T>): Promise<T> =>
    dependencies.measure ? dependencies.measure(phase, operation) : operation()

  dependencies.registerBeforeAll(async () => {
    branch = await measured('create', () => dependencies.createBranch(dependencies.branchPrefix(suiteName)))
    try {
      await measured('prepare', () => dependencies.prepare(branch!.connectionUri))
    } catch (error) {
      try {
        await measured('delete', () => dependencies.deleteBranch(branch!.branchId))
        branch = undefined
      } catch {
        throwCombined(error, true, [stableCleanupError('DB_CONTRACT_BRANCH_DELETION_UNPROVEN')])
      }
      throw error
    }
  })

  dependencies.registerAfterAll(async () => {
    if (!branch) return
    try {
      await measured('delete', () => dependencies.deleteBranch(branch!.branchId))
    } catch {
      throw stableCleanupError('DB_CONTRACT_BRANCH_DELETION_UNPROVEN')
    } finally {
      branch = undefined
    }
  })

  return async <T>(body: (context: TransactionalDbContext) => Promise<T>): Promise<T> => {
    if (!branch) throw new SuiteResourceError('DB_CONTRACT_SUITE_NOT_READY')
    const client = await dependencies.connect(branch.connectionUri)
    const sql = dependencies.transactionSql(client)
    let seed: Seed | undefined
    let value: T | undefined
    let primary: unknown
    let hasPrimary = false
    const cleanup: SuiteResourceError[] = []

    try {
      await client.query('BEGIN')
      await client.query('SAVEPOINT db_contract_test_root')
      seed = await measured('seed', () => dependencies.seed(sql))
      value = await body({ sql, seed, diagnostics: { topology: 'transactional-suite' } })
    } catch (error) {
      primary = error
      hasPrimary = true
    } finally {
      try {
        await measured('rollback', async () => { await client.query('ROLLBACK') })
      } catch {
        cleanup.push(stableCleanupError('DB_CONTRACT_ROLLBACK_UNPROVEN'))
      }
      if (seed) {
        try {
          await measured('observer', () => dependencies.observeSentinelAbsent(branch!.connectionUri, seed!.tenantId))
        } catch {
          cleanup.push(stableCleanupError('DB_CONTRACT_SENTINEL_LEAK_UNPROVEN'))
        }
      }
      try {
        await client.release()
      } catch {
        cleanup.push(stableCleanupError('DB_CONTRACT_SESSION_RELEASE_UNPROVEN'))
      }
    }

    if (hasPrimary || cleanup.length > 0) throwCombined(primary, hasPrimary, cleanup)
    return value as T
  }
}

export const withTransactionalDb = createTransactionalDbSuite
