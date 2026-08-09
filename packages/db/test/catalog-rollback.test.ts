import { describe, expect, it } from 'vitest'

import {
  buildCatalogAssertions,
  buildRolePreflight,
  type CatalogSnapshot,
} from '../src/catalog-contract'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MIGRATION_SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '0019_neon_authority_reconciliation.sql'),
  'utf8',
)
const SNAPSHOT = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'meta', '0019_snapshot.json'),
  'utf8',
)) as Snapshot

type SnapshotColumn = {
  name: string
  type: string
  notNull: boolean
  default?: string | number | boolean
  primaryKey?: boolean
}
type SnapshotIndex = {
  columns: Array<{ expression: string }>
  isUnique: boolean
  method: string
  where?: string
}
type SnapshotTable = {
  name: string
  columns: Record<string, SnapshotColumn>
  indexes: Record<string, SnapshotIndex>
  foreignKeys: Record<string, {
    tableTo: string
    columnsFrom: string[]
    columnsTo: string[]
    onDelete: string
    onUpdate: string
  }>
  uniqueConstraints: Record<string, { columns: string[] }>
  checkConstraints: Record<string, { value: string }>
}
type Snapshot = {
  tables: Record<string, SnapshotTable>
  enums: Record<string, { values: string[] }>
}
type EmbeddedCatalog = {
  version: string
  relations: Array<[string, string]>
  columns: Array<[string, string, number, string | null, boolean, string | number | boolean | null, string, string]>
  enums: Array<[string, string[]]>
  constraints: Array<{
    table: string
    name: string
    kind: string
    columns: string[]
    refTable?: string
    refColumns?: string[]
    onDelete?: string
    onUpdate?: string
  }>
  indexes: Array<{
    table: string
    name: string
    unique: boolean
    method: string
    keys: string[]
    opclasses: string[]
    include: string[]
    predicate: string | null
  }>
}

function embeddedCatalog(): EmbeddedCatalog {
  const match = MIGRATION_SQL.match(/\$catalog_contract_data\$([\s\S]+?)\$catalog_contract_data\$/)
  if (!match) throw new Error('0019 is missing its embedded catalog contract')
  return JSON.parse(match[1]) as EmbeddedCatalog
}

function assertSnapshotCovered(contract: EmbeddedCatalog): void {
  for (const [tableName, table] of Object.entries(SNAPSHOT.tables)) {
    if (!contract.relations.some(([name, kind]) => name === tableName && kind === 'r')) {
      throw new Error('relation missing: ' + tableName)
    }
    for (const [columnName, column] of Object.entries(table.columns)) {
      const row = contract.columns.find(([name]) => name === tableName + '.' + columnName)
      const expected = [
        tableName + '.' + columnName,
        column.type,
        column.type === 'vector(1536)' ? 1536 : -1,
        column.type === 'text' || column.type === 'text[]' ? 'default' : null,
        column.notNull !== true,
        column.default ?? null,
        '',
        '',
      ]
      if (!row || JSON.stringify(row) !== JSON.stringify(expected)) {
        throw new Error('column contract mismatch: ' + tableName + '.' + columnName)
      }
    }
    for (const [indexName, index] of Object.entries(table.indexes)) {
      const row = contract.indexes.find((candidate) => candidate.table === tableName && candidate.name === indexName)
      if (!row || row.unique !== index.isUnique || row.method !== index.method
        || JSON.stringify(row.keys) !== JSON.stringify(index.columns.map((column) => column.expression))
        || row.predicate !== (index.where ?? null)
        || row.opclasses.length !== row.keys.length || row.include.length !== 0) {
        throw new Error('index contract mismatch: ' + tableName + '.' + indexName)
      }
    }
    const expectedConstraintNames = [
      ...Object.values(table.columns).filter((column) => column.primaryKey).map(() => table.name + '_pkey'),
      ...Object.keys(table.foreignKeys),
      ...Object.keys(table.uniqueConstraints),
      ...Object.keys(table.checkConstraints),
    ]
    for (const name of expectedConstraintNames) {
      if (!contract.constraints.some((constraint) => constraint.table === tableName && constraint.name === name)) {
        throw new Error('constraint missing: ' + tableName + '.' + name)
      }
    }
    for (const [name, foreignKey] of Object.entries(table.foreignKeys)) {
      const constraint = contract.constraints.find((candidate) => candidate.table === tableName && candidate.name === name)
      if (!constraint || constraint.kind !== 'f'
        || JSON.stringify(constraint.columns) !== JSON.stringify(foreignKey.columnsFrom)
        || constraint.refTable !== 'public.' + foreignKey.tableTo
        || JSON.stringify(constraint.refColumns) !== JSON.stringify(foreignKey.columnsTo)
        || constraint.onDelete !== foreignKey.onDelete
        || constraint.onUpdate !== foreignKey.onUpdate) {
        throw new Error('foreign key contract mismatch: ' + tableName + '.' + name)
      }
    }
    for (const [name, check] of Object.entries(table.checkConstraints)) {
      const constraint = contract.constraints.find((candidate) => candidate.table === tableName && candidate.name === name)
      const referencedColumns = Object.keys(table.columns).filter((columnName) =>
        check.value.includes(`"${table.name}"."${columnName}"`),
      )
      if (!constraint || constraint.kind !== 'c'
        || JSON.stringify(constraint.columns) !== JSON.stringify(referencedColumns)) {
        throw new Error('check constraint contract mismatch: ' + tableName + '.' + name)
      }
    }
  }
  for (const [enumName, enumValue] of Object.entries(SNAPSHOT.enums)) {
    const row = contract.enums.find(([name]) => name === enumName)
    if (!row || JSON.stringify(row[1]) !== JSON.stringify(enumValue.values)) {
      throw new Error('enum contract mismatch: ' + enumName)
    }
  }
}

describe('0019 catalog rollback contract', () => {
  it('qualifies PostgreSQL 17 FK deparser output before comparing existing constraints', () => {
    const normalize = (definition: string) => definition
      .toLowerCase()
      .replaceAll('on update no action', '')
      .replace(/\s+/g, '')
      .replaceAll('"', '')

    const expected = normalize(
      'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action',
    )

    // PostgreSQL 17.10 omits the public schema when it is visible through the
    // default search_path. This is the exact deparse shape Neon returns.
    const defaultSearchPath = normalize(
      'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',
    )
    expect(defaultSearchPath).not.toContain(expected)

    const qualified = normalize(
      'FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE',
    )
    expect(qualified).toContain(expected)
    expect(normalize(
      'FOREIGN KEY (tenant_id) REFERENCES other.tenants(id) ON DELETE CASCADE',
    )).not.toContain(expected)

    const startMarker = '-- These FKs were intentionally unreachable'
    const endMarker = '-- Exact catalog assertions'
    const startIndex = MIGRATION_SQL.indexOf(startMarker)
    const endIndex = MIGRATION_SQL.indexOf(endMarker)
    expect(startIndex).toBeGreaterThanOrEqual(0)
    expect(endIndex).toBeGreaterThan(startIndex)

    const reconciliation = MIGRATION_SQL.slice(startIndex, endIndex)
    const capturePattern = /previous_search_path\s*:=\s*current_setting\('search_path'\)/i
    const setLocalPattern = /SET LOCAL search_path\s*=\s*pg_catalog;/i
    const restorePattern = /set_config\('search_path',\s*previous_search_path,\s*true\)/i
    const assertSearchPathOrder = (sql: string): void => {
      const captureIndex = sql.search(capturePattern)
      const setLocalIndex = sql.search(setLocalPattern)
      const restoreIndex = sql.search(restorePattern)
      expect(captureIndex).toBeGreaterThanOrEqual(0)
      expect(setLocalIndex).toBeGreaterThanOrEqual(0)
      expect(restoreIndex).toBeGreaterThanOrEqual(0)
      expect(captureIndex).toBeLessThan(setLocalIndex)
      expect(setLocalIndex).toBeLessThan(restoreIndex)
    }

    assertSearchPathOrder(reconciliation)

    const reorderedReconciliation = [
      "set_config('search_path', previous_search_path, true);",
      "previous_search_path := current_setting('search_path');",
      'SET LOCAL search_path = pg_catalog;',
    ].join('\n')
    expect(() => assertSearchPathOrder(reorderedReconciliation)).toThrow()
  })

  it('emits catalog assertions for every compatibility category', () => {
    const sql = buildCatalogAssertions({
      relations: ['public.users'],
      columns: ['public.users.id'],
      enums: ['public.status'],
      constraints: ['public.users.users_pkey'],
      indexes: ['public.users.users_id_idx'],
    })
    expect(sql).toMatch(/relation/i)
    expect(sql).toMatch(/typmod/i)
    expect(sql).toMatch(/collation/i)
    expect(sql).toMatch(/enum/i)
    expect(sql).toMatch(/constraint/i)
    expect(sql).toMatch(/index/i)
    expect(sql).toMatch(/raise exception/i)
    expect(sql).toMatch(/conrelid|indrelid/i)
  })

  it('preflights roles before object DDL and leaves a rollback marker', () => {
    const sql = buildRolePreflight(['product_suite_platform_runtime', 'product_suite_meeting_runtime'])
    expect(sql.indexOf('pg_roles')).toBeGreaterThanOrEqual(0)
    expect(sql).toMatch(/rolcanlogin/i)
    expect(sql).toMatch(/raise exception/i)
    expect(sql).toMatch(/before/i)
  })

  it('uses a typed snapshot shape for fixture-driven assertions', () => {
    const fixture: CatalogSnapshot = { relations: {}, columns: {}, enums: {}, constraints: {}, indexes: {} }
    expect(fixture).toBeDefined()
  })

  it('uses the genuine 0019 snapshot for exhaustive column, constraint, and index checks', () => {
    const contract = embeddedCatalog()
    expect(contract).toMatchObject({ version: 'catalog-contract-v1' })
    assertSnapshotCovered(contract)

    const removed = structuredClone(contract)
    removed.columns = removed.columns.filter(([name]) => !name.endsWith('.visibility'))
    expect(() => assertSnapshotCovered(removed)).toThrow(/visibility/)

    const incompatible = structuredClone(contract)
    const id = incompatible.columns.findIndex(([name]) => name.endsWith('.id'))
    incompatible.columns[id][5] = 'tampered-default'
    expect(() => assertSnapshotCovered(incompatible)).toThrow(/column contract mismatch/)

    const unsafeForeignKey = structuredClone(contract)
    const foreignKey = unsafeForeignKey.constraints.find((constraint) => constraint.kind === 'f')
    if (!foreignKey) throw new Error('fixture is missing a foreign key')
    foreignKey.onDelete = foreignKey.onDelete === 'cascade' ? 'restrict' : 'cascade'
    expect(() => assertSnapshotCovered(unsafeForeignKey)).toThrow(/foreign key contract mismatch/)
  })
})
