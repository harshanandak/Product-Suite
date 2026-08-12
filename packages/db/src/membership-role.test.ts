import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { organizationMemberships } from './meeting-schema'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

describe('canonical organization membership roles', () => {
  it('models the four-role database constraint', () => {
    const constraint = getTableConfig(organizationMemberships).checks.find(
      (candidate) => candidate.name === 'organization_memberships_role_canonical',
    )

    expect(constraint).toBeDefined()
  })

  it('journals a migration that rejects every non-canonical role', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'))
    const entry = journal.entries.find((candidate: { tag: string }) =>
      candidate.tag.endsWith('_canonical_membership_roles'),
    )

    expect(entry).toBeDefined()
    const migration = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8')
    expect(migration).toMatch(/add constraint "organization_memberships_role_canonical"/i)
    expect(migration).toMatch(
      /check\s*\(\s*"role"\s+in\s*\(\s*'viewer'\s*,\s*'member'\s*,\s*'admin'\s*,\s*'owner'\s*\)\s*\)/i,
    )
    expect(migration).not.toMatch(/org_admin/i)
  })
})
