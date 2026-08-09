import { describe, expect, it } from 'vitest'

import {
  assertCatalog,
  assertRequiredRoles,
  CatalogContractError,
  normalizeCatalogError,
  type CatalogSnapshot,
} from './catalog-contract'

const compatible: CatalogSnapshot = {
  relations: {
    users: { kind: 'r', schema: 'public' },
    tenants: { kind: 'r', schema: 'public' },
  },
  columns: {
    'users.id': {
      type: 'text',
      typmod: -1,
      collation: null,
      nullable: false,
      default: null,
      identity: '',
      generated: '',
    },
  },
  enums: {
    status: ['open', 'closed'],
  },
  constraints: {
    users_pkey: {
      definition: 'PRIMARY KEY (id)',
      columns: ['id'],
      referencedColumns: [],
      match: 's',
      deferrable: false,
      initiallyDeferred: false,
      onUpdate: 'a',
      onDelete: 'a',
    },
  },
  indexes: {
    users_id_idx: {
      unique: true,
      method: 'btree',
      keys: ['id'],
      opclasses: ['text_ops'],
      include: [],
      predicate: null,
    },
  },
}

describe('catalog contract', () => {
  it('accepts exact catalogs and returns structured mismatch errors', () => {
    expect(() => assertCatalog(compatible, compatible)).not.toThrow()

    const incompatible = structuredClone(compatible)
    incompatible.columns['users.id'].nullable = true
    expect(() => assertCatalog(compatible, incompatible)).toThrowError(/users\.id/i)

    const error = normalizeCatalogError(new CatalogContractError('column', 'users.id', {}, {}))
    expect(error).toMatchObject({ code: 'CATALOG_MISMATCH' })
    expect(error.message).not.toContain('postgres://')
  })

  it('rejects unexpected catalog objects instead of checking only the expected subset', () => {
    const actual = structuredClone(compatible)
    actual.relations['unexpected'] = { kind: 'r', schema: 'public' }
    expect(() => assertCatalog(compatible, actual)).toThrowError(/unexpected/i)
  })

  it('requires pre-existing NOLOGIN grant roles before object DDL', () => {
    expect(() => assertRequiredRoles([
      { name: 'product_suite_platform_runtime', canLogin: false, isSuperuser: false },
      { name: 'product_suite_meeting_runtime', canLogin: false, isSuperuser: false },
    ])).not.toThrow()

    expect(() => assertRequiredRoles([
      { name: 'product_suite_platform_runtime', canLogin: true, isSuperuser: false },
    ])).toThrowError(/NOLOGIN|role/i)
  })
})
