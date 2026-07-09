import { Hono } from 'hono'

import type { WorkItem } from '@product-suite/contracts'

import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/** Row shape returned by the tenant-scoped work_items query (snake_case DB columns). */
interface WorkItemRow {
  id: string
  title: string
  description: string | null
  phase: WorkItem['phase']
  type: WorkItem['type']
  priority: WorkItem['priority']
  tags: string[] | null
  source: WorkItem['source']
  project_id: string | null
  department: string
  assignee_id: string | null
  due_date: string | Date | null
  archived: boolean | null
  created_at: string | Date
  updated_at: string | Date
}

function toWorkItem(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    phase: row.phase,
    type: row.type,
    priority: row.priority,
    tags: row.tags ?? [],
    source: row.source,
    project_id: row.project_id,
    department: row.department,
    assignee_id: row.assignee_id,
    due_date: row.due_date == null ? null : String(row.due_date),
    archived: row.archived ?? false,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export const workItemsRoutes = new Hono<AuthedEnv>()

/**
 * List the work items the caller can see. Tenant-scoped: only items whose
 * workspace belongs to a tenant the caller is an *active* member of. The caller
 * is resolved from their Clerk identity (`claims.subject`) via the Alembic-owned
 * `user_auth_identities` -> `organization_memberships` chain, so this leaks
 * nothing across tenants even though it queries the shared DB.
 */
workItemsRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  const rows = (await sql`
    select wi.id, wi.title, wi.description, wi.phase, wi.type, wi.priority, wi.tags,
           wi.source, wi.project_id, wi.department, wi.assignee_id, wi.due_date,
           wi.archived, wi.created_at, wi.updated_at
    from work_items wi
    join workspaces w on w.id = wi.workspace_id
    where w.tenant_id in (
      select om.tenant_id
      from organization_memberships om
      join user_auth_identities uai on uai.user_id = om.user_id
      where uai.provider = 'clerk'
        and uai.provider_user_id = ${claims.subject}
        and om.status = 'active'
    )
    order by wi.updated_at desc
  `) as WorkItemRow[]

  return c.json(rows.map(toWorkItem))
})
