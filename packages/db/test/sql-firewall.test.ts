import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertMigrationSqlSafe,
  scanMigrationSql,
} from '../src/catalog-contract'

describe('authored migration SQL firewall', () => {
  it('ignores banned words in comments, quoted strings, and dollar quotes', () => {
    const safe = `-- INSERT UPDATE DELETE\nSELECT 'TRUNCATE COPY DROP';\nDO $$ BEGIN RAISE NOTICE 'MERGE'; END $$;`
    expect(scanMigrationSql(safe)).toEqual([])
    expect(() => assertMigrationSqlSafe(safe)).not.toThrow()
  })

  it('rejects DML and destructive DDL in authored SQL', () => {
    for (const token of ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY', 'TRUNCATE', 'DROP']) {
      expect(() => assertMigrationSqlSafe(`CREATE TABLE x (id text); ${token} x`)).toThrowError(
        new RegExp(token, 'i'),
      )
    }
  })

  it('rejects destructive ALTER statements instead of treating every ALTER as privilege syntax', () => {
    for (const statement of [
      'ALTER TABLE x DROP COLUMN y',
      'ALTER TABLE x DROP CONSTRAINT y',
      'ALTER TABLE x DROP TABLE y',
    ]) {
      expect(() => assertMigrationSqlSafe(statement)).toThrowError(/DROP/i)
    }
  })

  it('accepts the authored repair/checkpoint SQL, including grants and FK actions', () => {
    const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0019_neon_authority_reconciliation.sql'), 'utf8')
    expect(() => assertMigrationSqlSafe(migration)).not.toThrow()
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
    expect(migration).not.toMatch(/\bCREATE\s+SCHEMA\s+meeting\b/i)
  })
})
