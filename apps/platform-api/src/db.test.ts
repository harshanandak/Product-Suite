import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))
vi.mock('@product-suite/db', () => ({ createSql }))

import { sqlFrom } from './db'

describe('sqlFrom', () => {
  const original = process.env.DATABASE_URL

  beforeEach(() => {
    createSql.mockReset()
    createSql.mockReturnValue('sql-client')
  })
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  })

  it('creates the client from the env binding (preferred over process.env)', () => {
    process.env.DATABASE_URL = 'postgresql://env/db'
    const client = sqlFrom({ DATABASE_URL: 'postgresql://binding/db' })
    expect(createSql).toHaveBeenCalledWith('postgresql://binding/db')
    expect(client).toBe('sql-client')
  })

  it('falls back to process.env.DATABASE_URL when no binding is present', () => {
    process.env.DATABASE_URL = 'postgresql://env/db'
    sqlFrom({})
    expect(createSql).toHaveBeenCalledWith('postgresql://env/db')
  })

  it('throws when no connection string is configured', () => {
    delete process.env.DATABASE_URL
    expect(() => sqlFrom({})).toThrow('DATABASE_URL is not configured')
  })
})
