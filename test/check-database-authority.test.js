import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseNeonUrl,
  validateDatabaseAuthority,
} from '../scripts/check-database-authority.mjs'

const direct = 'postgresql://owner:very-secret@ep-cool-fire-123456.us-east-2.aws.neon.tech/neondb?sslmode=require'
const pooled = 'postgresql://runtime:very-secret@ep-cool-fire-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require'
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/check-database-authority.mjs')

describe('database authority', () => {
  test('accepts direct migration and pooled runtime Neon URLs with valid pins', () => {
    expect(parseNeonUrl(direct, 'migration')).toMatchObject({ provider: 'neon', purpose: 'migration', projectId: 'cool-fire-123456', branchId: 'cool-fire-123456' })
    expect(parseNeonUrl(pooled, 'runtime')).toMatchObject({ provider: 'neon', purpose: 'runtime', projectId: 'cool-fire-123456', branchId: 'cool-fire-123456' })
    expect(validateDatabaseAuthority({ environment: 'production', databaseUrl: pooled, migrationDatabaseUrl: direct, historyVariant: 'original-production' }).ok).toBe(true)
    expect(validateDatabaseAuthority({ environment: 'staging', databaseUrl: pooled, migrationDatabaseUrl: direct, historyVariant: 'repaired-bootstrap' }).ok).toBe(true)
  })

  test.each([
    ['Supabase', 'postgresql://u:p@db.example.supabase.co:5432/neondb?sslmode=require'],
    ['lookalike', 'postgresql://u:p@ep-cool-fire-123456.neon.tech.evil.example/neondb?sslmode=require'],
    ['wrong database', 'postgresql://u:p@ep-cool-fire-123456.us-east-2.aws.neon.tech/other?sslmode=require'],
    ['non TLS', 'postgresql://u:p@ep-cool-fire-123456.us-east-2.aws.neon.tech/neondb?sslmode=disable'],
  ])('rejects %s URL without exposing secrets', (_name, databaseUrl) => {
    const result = validateDatabaseAuthority({ environment: 'production', databaseUrl, migrationDatabaseUrl: direct, historyVariant: 'original-production' })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('very-secret')
    expect(JSON.stringify(result)).not.toContain('postgresql://')
  })

  test.each([
    ['provider mismatch', { environment: 'production', databaseUrl: pooled, migrationDatabaseUrl: 'postgresql://owner:very-secret@ep-other-branch-654321.us-east-2.aws.neon.tech/neondb?sslmode=require', historyVariant: 'original-production' }],
    ['two production URLs', { environment: 'production', databaseUrl: pooled, databaseUrlSecondary: pooled, migrationDatabaseUrl: direct, historyVariant: 'original-production' }],
    ['production repaired', { environment: 'production', databaseUrl: pooled, migrationDatabaseUrl: direct, historyVariant: 'repaired-bootstrap' }],
    ['fresh original', { environment: 'fresh', databaseUrl: pooled, migrationDatabaseUrl: direct, historyVariant: 'original-production' }],
    ['undeclared environment', { environment: 'preview', databaseUrl: pooled, migrationDatabaseUrl: direct, historyVariant: 'repaired-bootstrap' }],
  ])('rejects %s', (_name, input) => {
    expect(validateDatabaseAuthority(input)).toMatchObject({ ok: false })
  })

  test('CLI emits only redacted topology fields and fails safely', () => {
    const run = spawnSync(process.execPath, [scriptPath, '--environment', 'production', '--history-variant', 'original-production'], {
      env: { ...process.env, DATABASE_URL: pooled, MIGRATION_DATABASE_URL: direct },
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('provider=neon')
    expect(run.stdout).toContain('purpose=runtime')
    expect(`${run.stdout}${run.stderr}`).not.toContain('very-secret')
    expect(`${run.stdout}${run.stderr}`).not.toContain('postgresql://')
  })
})
