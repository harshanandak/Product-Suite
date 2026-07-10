import { Hono } from 'hono'

import type { WorkItemDependency } from '@product-suite/contracts'

import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/** Row shape from the tenant-scoped dependencies query (snake_case DB columns). */
interface DependencyRow {
  id: string
  source_item_id: string
  target_item_id: string
  relationship_type: WorkItemDependency['relationship_type']
  created_at: string | Date
}

function toDependency(row: DependencyRow): WorkItemDependency {
  return {
    id: row.id,
    source_item_id: row.source_item_id,
    target_item_id: row.target_item_id,
    relationship_type: row.relationship_type,
    created_at: String(row.created_at),
  }
}

export const dependenciesRoutes = new Hono<AuthedEnv>()

/**
 * List the dependency edges the caller can see — tenant-scoped by the edge's own
 * `tenant_id` (the org), to the tenants the caller is an active member of. The
 * `tenant_id` is the scope anchor (never returned to the client).
 */
dependenciesRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  let rows: DependencyRow[]
  try {
    rows = (await sql`
      select d.id, d.source_item_id, d.target_item_id, d.relationship_type, d.created_at
      from work_item_dependencies d
      where d.tenant_id in (
        select om.tenant_id
        from organization_memberships om
        join user_auth_identities uai on uai.user_id = om.user_id
        where uai.provider = 'clerk'
          and uai.provider_user_id = ${claims.subject}
          and om.status = 'active'
      )
      order by d.created_at
    `) as DependencyRow[]
  } catch (cause) {
    console.error('[dependencies] list query failed', cause)
    return c.json({ error: 'Failed to load dependencies' }, 500)
  }

  return c.json(rows.map(toDependency))
})
