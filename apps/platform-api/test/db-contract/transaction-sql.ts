/**
 * A deliberately small Neon-compatible SQL surface for transactional DB Contract
 * tests. It is test-only: the caller pins one PoolClient and owns its outer
 * transaction/rollback lifecycle. Application transactions become savepoints on
 * that same session instead of opening another connection.
 */

export type QueryRow = Record<string, unknown>
export type QueryRows = QueryRow[]

export interface PinnedPoolClient {
  query(text: string, params?: unknown[]): PromiseLike<{ rows: unknown[] }> | { rows: unknown[] }
}

const INTERNAL_ERROR_CODES = new Set([
  'DB_CONTRACT_INVALID_TEMPLATE',
  'DB_CONTRACT_QUERY_RESULT_INVALID',
  'DB_CONTRACT_QUERY_FAILED',
  'DB_CONTRACT_TRANSACTION_SHAPE',
  'DB_CONTRACT_TRANSACTION_FAILED',
  'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
  'DB_CONTRACT_UNSUPPORTED_QUERY_OPTIONS',
  'DB_CONTRACT_UNSUPPORTED_TRANSACTION_OPTIONS',
])

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/i
const POSTGRES_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/

function validSqlState(value: unknown): string | undefined {
  return typeof value === 'string' && SQLSTATE_PATTERN.test(value) ? value.toUpperCase() : undefined
}

function safeConstraint(value: unknown): string | undefined {
  return typeof value === 'string' && POSTGRES_IDENTIFIER_PATTERN.test(value) ? value : undefined
}

export class TransactionSqlError extends Error {
  readonly code: string
  readonly constraint?: string
  readonly internalCode?: string

  constructor(code: string, options: { constraint?: string; internalCode?: string } = {}) {
    super(code)
    this.name = 'TransactionSqlError'
    this.code = code
    this.constraint = options.constraint
    this.internalCode = options.internalCode ?? (INTERNAL_ERROR_CODES.has(code) ? code : undefined)
  }
}

type QueryExecutor<T> = () => Promise<T>

/**
 * Lazy query descriptor matching the thenable returned by Neon HTTP queries.
 * A descriptor is safe to construct while composing a transaction; the pinned
 * client is touched only when the descriptor is awaited by the caller/adapter.
 */
export class SqlQueryDescriptor<T extends QueryRows = QueryRows> implements PromiseLike<T> {
  readonly text: string
  private readonly executor: QueryExecutor<T>
  private readonly scopedExecutor: QueryExecutor<T>
  private result?: Promise<T>
  private source?: 'top-level' | 'scoped'

  constructor(text: string, executor: QueryExecutor<T>, scopedExecutor: QueryExecutor<T> = executor) {
    this.text = text
    this.executor = executor
    this.scopedExecutor = scopedExecutor
  }

  private promise(executor: QueryExecutor<T>, source: 'top-level' | 'scoped'): Promise<T> {
    if (this.result) {
      if (this.source !== source) {
        return Promise.reject(new TransactionSqlError('DB_CONTRACT_QUERY_DESCRIPTOR_REUSED'))
      }
      return this.result
    }
    if (this.source !== undefined && this.source !== source) {
      return Promise.reject(new TransactionSqlError('DB_CONTRACT_QUERY_DESCRIPTOR_REUSED'))
    }
    this.source = source
    this.result = executor()
    return this.result
  }

  /** Validate that no other scope has claimed this descriptor. */
  validateScoped(): void {
    if (this.source === 'top-level') {
      throw new TransactionSqlError('DB_CONTRACT_QUERY_DESCRIPTOR_REUSED')
    }
  }

  /** Claim a descriptor for a transaction before its savepoint starts. */
  claimScoped(): void {
    this.validateScoped()
    this.source ??= 'scoped'
  }

  /** Execute without acquiring the adapter's top-level session guard. */
  runScoped(): Promise<T> {
    return this.promise(this.scopedExecutor, 'scoped')
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.promise(this.executor, 'top-level').then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): PromiseLike<T | TResult> {
    return this.promise(this.executor, 'top-level').catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): PromiseLike<T> {
    return this.promise(this.executor, 'top-level').finally(onfinally)
  }
}

export interface TransactionSql {
  (strings: TemplateStringsArray, ...params: unknown[]): SqlQueryDescriptor
  query<Row extends QueryRow = QueryRow>(
    text: string,
    params?: unknown[],
    options?: Readonly<Record<string, unknown>>,
  ): SqlQueryDescriptor<Row[]>
  transaction(
    queriesOrFactory: readonly SqlQueryDescriptor[] | ((sql: TransactionSql) => readonly SqlQueryDescriptor[]),
    options?: Readonly<Record<string, unknown>>,
  ): Promise<QueryRows[]>
}

function unsupported(code: string): never {
  throw new TransactionSqlError(code)
}

function rejectOptions(options: Readonly<Record<string, unknown>> | undefined, code: string): void {
  if (options !== undefined && (typeof options !== 'object' || options === null || Object.keys(options).length > 0)) {
    unsupported(code)
  }
}

function redactedError(error: unknown, fallbackCode: string): TransactionSqlError {
  if (error instanceof TransactionSqlError && error.internalCode && INTERNAL_ERROR_CODES.has(error.internalCode)) {
    const sqlState = validSqlState(error.code)
    const code = sqlState ?? error.internalCode
    return new TransactionSqlError(code, {
      constraint: sqlState ? safeConstraint(error.constraint) : undefined,
      internalCode: error.internalCode,
    })
  }
  return new TransactionSqlError(fallbackCode)
}

function sanitizedDriverError(error: unknown): TransactionSqlError {
  const candidate = error as { code?: unknown; constraint?: unknown } | null
  const code = validSqlState(candidate?.code)
  return new TransactionSqlError(code ?? 'DB_CONTRACT_QUERY_FAILED', {
    constraint: code ? safeConstraint(candidate?.constraint) : undefined,
    internalCode: 'DB_CONTRACT_QUERY_FAILED',
  })
}

function taggedQuery(strings: TemplateStringsArray, params: readonly unknown[]): { text: string; params: unknown[] } {
  if (strings.length !== params.length + 1) {
    unsupported('DB_CONTRACT_INVALID_TEMPLATE')
  }

  let text = strings[0] ?? ''
  for (let index = 0; index < params.length; index += 1) {
    text += `$${index + 1}${strings[index + 1] ?? ''}`
  }
  return { text, params: [...params] }
}

function isQueryDescriptor(value: unknown): value is SqlQueryDescriptor {
  return value instanceof SqlQueryDescriptor
}

export function createTransactionSql(client: PinnedPoolClient): TransactionSql {
  let savepointNumber = 0
  let sessionTail = Promise.resolve()

  const runExclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const previous = sessionTail
    let release!: () => void
    sessionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    return previous.then(job).finally(release)
  }

  const execute = async (text: string, params: unknown[] = []): Promise<QueryRows> => {
    try {
      const result = await client.query(text, params)
      if (Array.isArray(result)) return result as QueryRows
      if (!result || !Array.isArray(result.rows)) {
        throw new TransactionSqlError('DB_CONTRACT_QUERY_RESULT_INVALID')
      }
      return result.rows as QueryRows
    } catch (error) {
      if (error instanceof TransactionSqlError && error.internalCode && INTERNAL_ERROR_CODES.has(error.internalCode)) {
        throw redactedError(error, error.internalCode)
      }
      throw sanitizedDriverError(error)
    }
  }

  const makeQuery = <Row extends QueryRow = QueryRow>(text: string, params: unknown[] = []): SqlQueryDescriptor<Row[]> => {
    const preservedParams = [...params]
    return new SqlQueryDescriptor<Row[]>(
      text,
      () => runExclusive(() => execute(text, preservedParams) as Promise<Row[]>),
      () => execute(text, preservedParams) as Promise<Row[]>,
    )
  }

  const sql = ((strings: TemplateStringsArray, ...params: unknown[]) => {
    const query = taggedQuery(strings, params)
    return makeQuery(query.text, query.params)
  }) as TransactionSql

  sql.query = <Row extends QueryRow = QueryRow>(
    text: string,
    params: unknown[] = [],
    options?: Readonly<Record<string, unknown>>,
  ): SqlQueryDescriptor<Row[]> => {
    rejectOptions(options, 'DB_CONTRACT_UNSUPPORTED_QUERY_OPTIONS')
    return makeQuery<Row>(text, params)
  }

  sql.transaction = (
    queriesOrFactory: readonly SqlQueryDescriptor[] | ((transactionSql: TransactionSql) => readonly SqlQueryDescriptor[]),
    options?: Readonly<Record<string, unknown>>,
  ): Promise<QueryRows[]> => {
    rejectOptions(options, 'DB_CONTRACT_UNSUPPORTED_TRANSACTION_OPTIONS')

    const resolveQueries = (): readonly SqlQueryDescriptor[] => {
      let queries: unknown
      try {
        queries = typeof queriesOrFactory === 'function' ? queriesOrFactory(sql) : queriesOrFactory
      } catch (error) {
        throw redactedError(error, 'DB_CONTRACT_TRANSACTION_SHAPE')
      }
      if (!Array.isArray(queries) || !queries.every(isQueryDescriptor)) {
        throw new TransactionSqlError('DB_CONTRACT_TRANSACTION_SHAPE')
      }
      return queries
    }

    let queries: readonly SqlQueryDescriptor[]
    try {
      queries = resolveQueries()
      for (const query of queries) query.validateScoped()
      for (const query of queries) query.claimScoped()
    } catch (error) {
      return Promise.reject(redactedError(error, 'DB_CONTRACT_TRANSACTION_SHAPE'))
    }

    return runExclusive(async () => {
      const savepoint = `db_contract_sp_${++savepointNumber}`
      await execute(`SAVEPOINT ${savepoint}`)

      try {
        const results: QueryRows[] = []
        for (const query of queries) results.push(await query.runScoped())
        await execute(`RELEASE SAVEPOINT ${savepoint}`)
        return results
      } catch (error) {
        const primary = redactedError(error, 'DB_CONTRACT_TRANSACTION_FAILED')
        try {
          await execute(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        } catch {
          // Preserve the first stable failure; no driver detail is safe to expose.
        }
        try {
          await execute(`RELEASE SAVEPOINT ${savepoint}`)
        } catch {
          // Preserve the first stable failure; no driver detail is safe to expose.
        }
        throw primary
      }
    })
  }

  return sql
}
