import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { migrationStatements } from './migration-statements'

describe('migration statements', () => {
  it('segments canonical 0021 into one prepared statement per top-level command', () => {
    const migration = readFileSync(resolve(import.meta.dirname, '../migrations/0021_command_kernel.sql'), 'utf8')

    const statements = migrationStatements(migration)

    expect(statements).toHaveLength(16)
    expect(statements[0]).toBe('ALTER TABLE "work_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;')
    expect(statements[13]).toContain('DO $immutable_triggers$')
    expect(statements[15]).toBe('GRANT SELECT, INSERT ON TABLE "command_audit_events" TO product_suite_platform_runtime;')
  })
})
