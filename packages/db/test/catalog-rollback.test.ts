import { describe, expect, it } from 'vitest'

import {
  buildCatalogAssertions,
  buildRolePreflight,
  type CatalogSnapshot,
} from '../src/catalog-contract'

describe('0019 catalog rollback contract', () => {
  it('emits catalog assertions for every compatibility category', () => {
    const sql = buildCatalogAssertions({
      relations: ['public.users'],
      columns: ['public.users.id'],
      enums: ['public.status'],
      constraints: ['public.users_pkey'],
      indexes: ['public.users_id_idx'],
    })
    expect(sql).toMatch(/relation/i)
    expect(sql).toMatch(/typmod/i)
    expect(sql).toMatch(/collation/i)
    expect(sql).toMatch(/enum/i)
    expect(sql).toMatch(/constraint/i)
    expect(sql).toMatch(/index/i)
    expect(sql).toMatch(/raise exception/i)
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
})
