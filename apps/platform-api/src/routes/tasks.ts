import { Hono } from 'hono'

import type { Task } from '@product-suite/contracts'

import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/** Row shape from the tenant-scoped tasks query (snake_case DB columns). */
interface TaskRow {
  id: string
  work_item_id: string
  title: string
  status: Task['status']
  due_date: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    work_item_id: row.work_item_id,
    title: row.title,
    status: row.status,
    due_date: row.due_date == null ? null : String(row.due_date),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export const tasksRoutes = new Hono<AuthedEnv>()

/**
 * List the tasks the caller can see — tenant-scoped through the task's work item
 * and workspace to the tenants the caller is an active member of (same Clerk
 * identity → `user_auth_identities` → `organization_memberships` chain as
 * `/api/work-items`, so no cross-tenant leak on the shared DB).
 */
tasksRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  let rows: TaskRow[]
  try {
    rows = (await sql`
      select t.id, t.work_item_id, t.title, t.status, t.due_date, t.created_at, t.updated_at
      from tasks t
      join work_items wi on wi.id = t.work_item_id
      join workspaces w on w.id = wi.workspace_id
      where w.tenant_id in (
        select om.tenant_id
        from organization_memberships om
        join user_auth_identities uai on uai.user_id = om.user_id
        where uai.provider = 'clerk'
          and uai.provider_user_id = ${claims.subject}
          and om.status = 'active'
      )
      order by t.created_at
    `) as TaskRow[]
  } catch (cause) {
    console.error('[tasks] list query failed', cause)
    return c.json({ error: 'Failed to load tasks' }, 500)
  }

  return c.json(rows.map(toTask))
})
