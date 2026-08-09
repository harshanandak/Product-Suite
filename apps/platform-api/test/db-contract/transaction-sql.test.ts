import { describe, expect, it, vi } from 'vitest'

import { createTransactionSql, TransactionSqlError } from './transaction-sql'

type QueryCall = { text: string; params: unknown[] }

function mockedClient(options: { fail?: (text: string) => Error | undefined } = {}) {
  const calls: QueryCall[] = []
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params })
    const failure = options.fail?.(text)
    if (failure) throw failure
    return { rows: [{ text }] }
  })
  return { client: { query }, calls }
}

describe('transaction-bound Neon SQL adapter', () => {
  it('parameterizes tagged-template interpolation without embedding values', async () => {
    const secret = 'tenant-secret-value'
    const { client, calls } = mockedClient()
    const sql = createTransactionSql(client)

    await sql`select ${secret} as secret, ${42} as answer`

    expect(calls).toEqual([{ text: 'select $1 as secret, $2 as answer', params: [secret, 42] }])
    expect(calls[0]?.text).not.toContain(secret)
  })

  it('executes a lazy descriptor only once when awaited repeatedly', async () => {
    const { client, calls } = mockedClient()
    const sql = createTransactionSql(client)
    const descriptor = sql.query('select $1', ['opaque-value'])

    expect(client.query).not.toHaveBeenCalled()
    await descriptor
    await descriptor

    expect(client.query).toHaveBeenCalledOnce()
    expect(calls).toEqual([{ text: 'select $1', params: ['opaque-value'] }])
  })

  it('runs application transactions in one pinned session with a savepoint', async () => {
    const secret = 'never-in-sql'
    const { client, calls } = mockedClient()
    const sql = createTransactionSql(client)

    const results = await sql.transaction([
      sql.query('insert into records (value) values ($1) returning value', [secret]),
      sql`select ${secret} as value`,
    ])

    expect(results).toHaveLength(2)
    expect(calls.map(({ text }) => text)).toEqual([
      'SAVEPOINT db_contract_sp_1',
      'insert into records (value) values ($1) returning value',
      'select $1 as value',
      'RELEASE SAVEPOINT db_contract_sp_1',
    ])
    expect(calls.every(({ text }) => !text.includes(secret))).toBe(true)
    expect(calls[1]?.params).toEqual([secret])
    expect(calls[2]?.params).toEqual([secret])
  })

  it('rolls back to and releases the savepoint on a failed application transaction', async () => {
    const secret = 'private-query-value'
    const { client, calls } = mockedClient({
      fail: (text) => (text === 'select $1 as value' ? new Error(`driver exposed ${secret}`) : undefined),
    })
    const sql = createTransactionSql(client)

    await expect(
      sql.transaction([sql`select ${secret} as value`]),
    ).rejects.toMatchObject({ code: 'DB_CONTRACT_QUERY_FAILED' })

    expect(calls.map(({ text }) => text)).toEqual([
      'SAVEPOINT db_contract_sp_1',
      'select $1 as value',
      'ROLLBACK TO SAVEPOINT db_contract_sp_1',
      'RELEASE SAVEPOINT db_contract_sp_1',
    ])
    expect(calls.every(({ text }) => !text.includes(secret))).toBe(true)
    await expect(sql.query('select $1', [secret])).resolves.toEqual([{ text: 'select $1' }])
    expect(String(new TransactionSqlError('DB_CONTRACT_QUERY_FAILED'))).not.toContain(secret)
  })

  it('recovers the outer transaction after an expected direct statement failure', async () => {
    const calls: string[] = []
    let aborted = false
    const constraintFailure = Object.assign(new Error('raw detail'), {
      code: '23514',
      constraint: 'memories_private_requires_owner',
    })
    const query = vi.fn(async (text: string) => {
      calls.push(text)
      if (text === 'insert malformed') {
        aborted = true
        throw constraintFailure
      }
      if (text.startsWith('ROLLBACK TO SAVEPOINT')) aborted = false
      if (aborted) throw Object.assign(new Error('transaction aborted'), { code: '25P02' })
      return { rows: [{ ok: true }] }
    })
    const sql = createTransactionSql({ query })

    await expect(sql.query('insert malformed')).rejects.toMatchObject({
      code: '23514',
      constraint: 'memories_private_requires_owner',
    })
    await expect(sql.query('select still usable')).resolves.toEqual([{ ok: true }])

    expect(calls).toEqual([
      'SAVEPOINT db_contract_query_sp_1',
      'insert malformed',
      'ROLLBACK TO SAVEPOINT db_contract_query_sp_1',
      'RELEASE SAVEPOINT db_contract_query_sp_1',
      'select still usable',
    ])
  })

  it('uses a unique savepoint for each nested application transaction', async () => {
    const { client, calls } = mockedClient()
    const sql = createTransactionSql(client)

    await sql.transaction([sql.query('select 1')])
    await sql.transaction([sql.query('select 2')])

    expect(calls.map(({ text }) => text)).toEqual([
      'SAVEPOINT db_contract_sp_1',
      'select 1',
      'RELEASE SAVEPOINT db_contract_sp_1',
      'SAVEPOINT db_contract_sp_2',
      'select 2',
      'RELEASE SAVEPOINT db_contract_sp_2',
    ])
  })

  it('serializes concurrent top-level transactions and direct queries on the pinned session', async () => {
    const calls: QueryCall[] = []
    let releaseFirstSavepoint!: () => void
    const firstSavepoint = new Promise<void>((resolve) => {
      releaseFirstSavepoint = resolve
    })
    let firstSavepointSeen = false
    const query = vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params })
      if (text === 'SAVEPOINT db_contract_sp_1' && !firstSavepointSeen) {
        firstSavepointSeen = true
        await firstSavepoint
      }
      return { rows: [] }
    })
    const sql = createTransactionSql({ query })

    const first = sql.transaction([sql.query('select 1')])
    await Promise.resolve()
    expect(calls.map(({ text }) => text)).toEqual(['SAVEPOINT db_contract_sp_1'])

    const second = sql.transaction([sql.query('select 2')])
    const direct = Promise.resolve(sql.query('select direct'))

    // The first scope owns the session while its savepoint is pending. Neither
    // another savepoint nor an unrelated direct query may interleave with it.
    expect(calls.map(({ text }) => text)).toEqual(['SAVEPOINT db_contract_sp_1'])

    releaseFirstSavepoint()
    await Promise.all([first, second, direct])

    expect(calls.map(({ text }) => text)).toEqual([
      'SAVEPOINT db_contract_sp_1',
      'select 1',
      'RELEASE SAVEPOINT db_contract_sp_1',
      'SAVEPOINT db_contract_sp_2',
      'select 2',
      'RELEASE SAVEPOINT db_contract_sp_2',
      'select direct',
    ])
  })

  it('normalizes arbitrary TransactionSqlError codes and messages', async () => {
    const secret = 'driver-secret-code'
    const leaked = new TransactionSqlError(secret)
    const { client } = mockedClient({ fail: () => leaked })
    const sql = createTransactionSql(client)

    const rejection = sql.query('select 1')
    await expect(rejection).rejects.toMatchObject({
      code: 'DB_CONTRACT_QUERY_FAILED',
      message: 'DB_CONTRACT_QUERY_FAILED',
    })
    try {
      await rejection
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })

  it('fails closed instead of self-deadlocking when one descriptor is shared across scopes', async () => {
    const calls: QueryCall[] = []
    const sharedValue = 'shared-secret'
    let releaseFirstSavepoint!: () => void
    const firstSavepoint = new Promise<void>((resolve) => {
      releaseFirstSavepoint = resolve
    })
    const query = vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params })
      if (text === 'SAVEPOINT db_contract_sp_1') await firstSavepoint
      return { rows: [] }
    })
    const sql = createTransactionSql({ query })
    const descriptor = sql.query('select $1', [sharedValue])
    const transaction = sql.transaction([descriptor])

    await Promise.resolve()
    expect(calls.map(({ text }) => text)).toEqual(['SAVEPOINT db_contract_sp_1'])
    const direct = Promise.resolve(descriptor)
    releaseFirstSavepoint()

    const outcome = await Promise.race([
      Promise.allSettled([transaction, direct]),
      new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), 100)),
    ])
    expect(outcome).not.toBe('TIMEOUT')
    if (outcome === 'TIMEOUT') return

    expect(outcome[0]?.status).toBe('fulfilled')
    expect(outcome[1]?.status).toBe('rejected')
    if (outcome[1]?.status === 'rejected') {
      expect(outcome[1].reason).toMatchObject({
        code: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
        message: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
      })
      expect(String(outcome[1].reason)).not.toContain(sharedValue)
    }
    expect(calls.map(({ text }) => text)).toEqual([
      'SAVEPOINT db_contract_sp_1',
      'select $1',
      'RELEASE SAVEPOINT db_contract_sp_1',
    ])
  })

  it('rejects a completed top-level descriptor reused by a transaction', async () => {
    const { client, calls } = mockedClient()
    const sql = createTransactionSql(client)
    const descriptor = sql.query('select 1')

    await expect(descriptor).resolves.toEqual([{ text: 'select 1' }])
    await expect(sql.transaction([descriptor])).rejects.toMatchObject({
      code: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
      message: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
    })
    expect(calls.map(({ text }) => text)).toEqual(['select 1'])
  })

  it('rejects a completed scoped descriptor reused by a top-level await', async () => {
    const { client, calls } = mockedClient()
    const sql = createTransactionSql(client)
    const descriptor = sql.query('select 1')

    await expect(sql.transaction([descriptor])).resolves.toEqual([[{ text: 'select 1' }]])
    await expect(Promise.resolve(descriptor)).rejects.toMatchObject({
      code: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
      message: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
    })
    expect(calls.map(({ text }) => text)).toEqual([
      'SAVEPOINT db_contract_sp_1',
      'select 1',
      'RELEASE SAVEPOINT db_contract_sp_1',
    ])
  })

  it('preflights every transaction descriptor before claiming any of them', async () => {
    const { client, calls } = mockedClient()
    const sql = createTransactionSql(client)
    const reusable = sql.query('select reusable')
    const conflicting = sql.query('select conflicting')

    await expect(conflicting).resolves.toEqual([{ text: 'select conflicting' }])
    await expect(sql.transaction([reusable, conflicting])).rejects.toMatchObject({
      code: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
      message: 'DB_CONTRACT_QUERY_DESCRIPTOR_REUSED',
    })
    await expect(reusable).resolves.toEqual([{ text: 'select reusable' }])
    expect(calls.map(({ text }) => text)).toEqual(['select conflicting', 'select reusable'])
  })

  it.each(['22P02', '23503', '23505'] as const)(
    'preserves SQLSTATE %s and a safe constraint identity without raw driver details',
    async (code) => {
      const secret = 'tenant-id=secret-value'
      const driverError = Object.assign(new Error(`raw message ${secret}`), {
        code,
        constraint: 'meeting_promotions_tenant_record_uniq',
        detail: `detail ${secret}`,
        hint: `hint ${secret}`,
        query: `select ${secret}`,
        params: [secret],
        url: `postgresql://${secret}@host/db`,
      })
      const { client } = mockedClient({ fail: () => driverError })
      const sql = createTransactionSql(client)
      const rejection = sql.query('select 1')

      await expect(rejection).rejects.toMatchObject({
        code,
        constraint: 'meeting_promotions_tenant_record_uniq',
        message: code,
      })
      try {
        await rejection
      } catch (error) {
        expect(String(error)).not.toContain(secret)
        expect(String(error)).not.toContain('raw message')
        expect(String(error)).not.toContain('detail')
        expect(String(error)).not.toContain('hint')
        expect(String(error)).not.toContain('postgresql://')
      }
    },
  )

  it('uses the stable fallback and omits unsafe PostgreSQL metadata', async () => {
    const secret = 'raw-driver-secret'
    const invalidPgError = Object.assign(new Error(`invalid detail ${secret}`), {
      code: '2350',
      constraint: 'unsafe constraint; drop table users',
      detail: secret,
      hint: secret,
      query: `select ${secret}`,
      params: [secret],
    })
    const { client } = mockedClient({ fail: () => invalidPgError })
    const sql = createTransactionSql(client)
    const rejection = sql.query('select 1')

    await expect(rejection).rejects.toMatchObject({
      code: 'DB_CONTRACT_QUERY_FAILED',
      message: 'DB_CONTRACT_QUERY_FAILED',
    })
    try {
      await rejection
    } catch (error) {
      expect((error as { constraint?: unknown }).constraint).toBeUndefined()
      expect(String(error)).not.toContain(secret)
      expect(String(error)).not.toContain('unsafe constraint')
    }
  })

  it('rejects unsupported options with stable redacted errors', () => {
    const { client } = mockedClient()
    const sql = createTransactionSql(client)

    expect(() => sql.query('select 1', [], { fullResults: true, token: 'secret' })).toThrowError(
      new TransactionSqlError('DB_CONTRACT_UNSUPPORTED_QUERY_OPTIONS'),
    )
    expect(() => sql.transaction([], { isolationLevel: 'Serializable', token: 'secret' })).toThrowError(
      new TransactionSqlError('DB_CONTRACT_UNSUPPORTED_TRANSACTION_OPTIONS'),
    )
    try {
      sql.query('select 1', [], { token: 'secret' })
    } catch (error) {
      expect(String(error)).not.toContain('secret')
    }
  })
})
