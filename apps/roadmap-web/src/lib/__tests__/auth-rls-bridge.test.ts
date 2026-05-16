import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  RLS_AUTH_BRIDGE_REQUIREMENT,
  ROADMAP_RLS_AUTH_UID_POLICY_FILES,
} from '../auth-rls-bridge'

const migrationsDir = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url))

describe('roadmap Supabase RLS auth bridge audit', () => {
  it('tracks every migration file whose policies still depend on auth.uid()', () => {
    const authUidPolicyFiles = readdirSync(migrationsDir)
      .filter((fileName) => fileName.endsWith('.sql'))
      .filter((fileName) =>
        readFileSync(join(migrationsDir, fileName), 'utf8').includes('auth.uid()'),
      )
      .sort()

    expect(authUidPolicyFiles).toEqual([...ROADMAP_RLS_AUTH_UID_POLICY_FILES].sort())
    expect(RLS_AUTH_BRIDGE_REQUIREMENT).toContain('RLS-compatible canonical token')
    expect(RLS_AUTH_BRIDGE_REQUIREMENT).toContain('server-side membership checks')
  })
})
