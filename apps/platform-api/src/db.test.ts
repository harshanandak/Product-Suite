import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))
vi.mock('@product-suite/db', () => ({ createSql }))

import { CANONICAL_REVISION_HASH, databaseReadiness, parseRuntimeNeonUrl, sqlFrom } from './db'

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

describe('runtime Neon authority and readiness', () => {
  it('accepts only pooled Neon URLs for application runtime', () => {
    expect(
      parseRuntimeNeonUrl(
        'postgresql://runtime:secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
      ),
    ).toMatchObject({ provider: 'neon', database: 'neondb', pooled: true })
  })

  it.each([
    ['direct migration URL', 'postgresql://runtime:secret@ep-cool-fire-123456.us-east-2.aws.neon.tech/neondb?sslmode=require'],
    ['Supabase URL', 'postgresql://runtime:secret@db.example.supabase.co/postgres?sslmode=require'],
    ['wrong database', 'postgresql://runtime:secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/other?sslmode=require'],
  ])('rejects %s without including URL material', (_label, url) => {
    expect(() => parseRuntimeNeonUrl(url)).toThrow()
    try {
      parseRuntimeNeonUrl(url)
    } catch (error) {
      expect(String(error)).not.toContain('secret')
      expect(String(error)).not.toContain(url)
    }
  })

  it('returns opaque readiness only when the canonical floor is present', async () => {
    const ready = await databaseReadiness(
      { DATABASE_URL: 'postgresql://runtime:secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require' },
      async () => ({ rows: [{ hash: CANONICAL_REVISION_HASH }] }),
    )
    expect(ready).toEqual({ ok: true, provider: 'neon', schema: 'public', revision: '0021_command_kernel' })

    const notReady = await databaseReadiness(
      { DATABASE_URL: 'postgresql://runtime:secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require' },
      async () => ({ rows: [{ hash: 'older-migration-hash' }] }),
    )
    expect(notReady).toEqual({ ok: false, code: 'DATABASE_REVISION_NOT_READY' })

    const laterRevision = await databaseReadiness(
      { DATABASE_URL: 'postgresql://runtime:secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require' },
      async () => ({ rows: [
        { hash: 'later-migration-hash' },
        { hash: CANONICAL_REVISION_HASH },
      ] }),
    )
    expect(laterRevision.ok).toBe(true)
  })

  it('uses the default Neon tagged-template client to probe the canonical floor', async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      expect(strings.join('?')).toBe('select hash from drizzle.__drizzle_migrations where hash = ? limit 1')
      expect(values).toEqual([CANONICAL_REVISION_HASH])
      return [{ hash: CANONICAL_REVISION_HASH }]
    })
    createSql.mockReturnValue(sql)

    await expect(databaseReadiness({
      DATABASE_URL: 'postgresql://runtime:secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
    })).resolves.toEqual({
      ok: true,
      provider: 'neon',
      schema: 'public',
      revision: '0021_command_kernel',
    })
    expect(sql).toHaveBeenCalledOnce()
  })

  it('redacts missing configuration and query failures', async () => {
    expect(await databaseReadiness({})).toEqual({ ok: false, code: 'DATABASE_URL_NOT_CONFIGURED' })
    expect(
      await databaseReadiness(
        { DATABASE_URL: 'postgresql://runtime:secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require' },
        async () => { throw new Error('postgresql://runtime:secret query detail') },
      ),
    ).toEqual({ ok: false, code: 'DATABASE_NOT_READY' })
  })
})
