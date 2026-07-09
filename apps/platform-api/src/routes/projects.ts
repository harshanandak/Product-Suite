import { Hono } from 'hono'

import type { Project } from '@product-suite/contracts'

import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/** Row shape from the tenant-scoped projects query (snake_case DB columns). */
interface ProjectRow {
  id: string
  name: string
  kind: string
  created_at: string | Date
  updated_at: string | Date
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export const projectsRoutes = new Hono<AuthedEnv>()

/**
 * List the projects the caller can see — tenant-scoped through the project's
 * workspace to the tenants the caller is an active member of.
 */
projectsRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  let rows: ProjectRow[]
  try {
    rows = (await sql`
      select p.id, p.name, p.kind, p.created_at, p.updated_at
      from projects p
      join workspaces w on w.id = p.workspace_id
      where w.tenant_id in (
        select om.tenant_id
        from organization_memberships om
        join user_auth_identities uai on uai.user_id = om.user_id
        where uai.provider = 'clerk'
          and uai.provider_user_id = ${claims.subject}
          and om.status = 'active'
      )
      order by p.name
    `) as ProjectRow[]
  } catch (cause) {
    console.error('[projects] list query failed', cause)
    return c.json({ error: 'Failed to load projects' }, 500)
  }

  return c.json(rows.map(toProject))
})
