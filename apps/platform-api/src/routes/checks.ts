import { Hono } from 'hono'

import { type Check, CHECK_STATUS_ORDER } from '@product-suite/contracts'

import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/** Row shape from the tenant-scoped checks query (snake_case DB columns). */
interface CheckRow {
  id: string
  work_item_id: string
  title: string
  status: Check['status']
  due_date: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

/** Editable surface of a check. */
type CheckPatch = Partial<Pick<Check, 'title' | 'status' | 'due_date'>>
/** Input to create a check — always born under a work item. */
type CreateCheckBody = { work_item_id?: string; title?: string } & CheckPatch

function toCheck(row: CheckRow): Check {
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

export const checksRoutes = new Hono<AuthedEnv>()

/**
 * List the checks the caller can see — tenant-scoped through the check's work item
 * to the orgs the caller is an active member of (same Clerk identity →
 * `user_auth_identities` → `organization_memberships` chain as `/api/work-items`,
 * so no cross-tenant leak on the shared DB).
 */
checksRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  let rows: CheckRow[]
  try {
    rows = (await sql`
      select t.id, t.work_item_id, t.title, t.status, t.due_date, t.created_at, t.updated_at
      from checks t
      join work_items wi on wi.id = t.work_item_id
      where wi.tenant_id in (
        select om.tenant_id
        from organization_memberships om
        join user_auth_identities uai on uai.user_id = om.user_id
        where uai.provider = 'clerk'
          and uai.provider_user_id = ${claims.subject}
          and om.status = 'active'
      )
      order by t.created_at
    `) as CheckRow[]
  } catch (cause) {
    console.error('[checks] list query failed', cause)
    return c.json({ error: 'Failed to load checks' }, 500)
  }

  return c.json(rows.map(toCheck))
})

/**
 * Create a check under a work item the caller owns (a check is always born under a
 * work item — §1). Guarded: the parent work item must be in one of the caller's orgs
 * (else 404), so a check can't be attached to another org's item.
 */
checksRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const body = (await c.req.json().catch(() => ({}))) as CreateCheckBody

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }
    if (!body.work_item_id) {
      return c.json({ error: 'work_item_id is required' }, 400)
    }

    const owned = (await sql`
      select 1 from work_items where id = ${body.work_item_id} and tenant_id = any(${tenantIds})
    `) as unknown[]
    if (owned.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const rows = (await sql`
      insert into checks (work_item_id, title, status, due_date)
      values (${body.work_item_id}, ${body.title ?? 'Untitled check'},
              ${body.status ?? 'todo'}, ${body.due_date ?? null})
      returning id, work_item_id, title, status, due_date, created_at, updated_at
    `) as CheckRow[]
    const created = rows[0]
    if (!created) {
      return c.json({ error: 'Failed to create check' }, 500)
    }
    return c.json(toCheck(created), 201)
  } catch (cause) {
    console.error('[checks] create failed', cause)
    return c.json({ error: 'Failed to create check' }, 500)
  }
})

/** Fetch a check scoped to the caller's orgs (via its parent work item), or null. */
async function ownedCheck(
  sql: ReturnType<typeof sqlFrom>,
  id: string,
  tenantIds: string[],
): Promise<CheckRow | null> {
  const rows = (await sql`
    select t.id, t.work_item_id, t.title, t.status, t.due_date, t.created_at, t.updated_at
    from checks t
    join work_items wi on wi.id = t.work_item_id
    where t.id = ${id} and wi.tenant_id = any(${tenantIds})
  `) as CheckRow[]
  return rows[0] ?? null
}

/**
 * Apply an editable patch to a check (title / status / due_date). Guarded by the
 * caller's org through the parent work item.
 */
checksRoutes.patch('/:id', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')
  const patch = (await c.req.json().catch(() => ({}))) as CheckPatch

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }
    const current = await ownedCheck(sql, id, tenantIds)
    if (!current) {
      return c.json({ error: 'Not found' }, 404)
    }

    const next = { ...current, ...patch }
    const rows = (await sql`
      update checks set
        title = ${next.title},
        status = ${next.status},
        due_date = ${next.due_date ?? null},
        updated_at = now()
      where id = ${id}
        and work_item_id in (select id from work_items where tenant_id = any(${tenantIds}))
      returning id, work_item_id, title, status, due_date, created_at, updated_at
    `) as CheckRow[]
    const updated = rows[0]
    if (!updated) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(toCheck(updated))
  } catch (cause) {
    console.error('[checks] update failed', cause)
    return c.json({ error: 'Failed to update check' }, 500)
  }
})

/**
 * Advance a check one step around the status triad (`todo → in_progress →
 * completed → todo`) — the one-tap lifecycle gesture. Guarded by the caller's org.
 */
checksRoutes.post('/:id/toggle', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }
    const current = await ownedCheck(sql, id, tenantIds)
    if (!current) {
      return c.json({ error: 'Not found' }, 404)
    }

    const position = CHECK_STATUS_ORDER.indexOf(current.status)
    const nextStatus =
      CHECK_STATUS_ORDER[(position + 1) % CHECK_STATUS_ORDER.length] ?? 'todo'

    const rows = (await sql`
      update checks set status = ${nextStatus}, updated_at = now()
      where id = ${id}
        and work_item_id in (select id from work_items where tenant_id = any(${tenantIds}))
      returning id, work_item_id, title, status, due_date, created_at, updated_at
    `) as CheckRow[]
    const updated = rows[0]
    if (!updated) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(toCheck(updated))
  } catch (cause) {
    console.error('[checks] toggle failed', cause)
    return c.json({ error: 'Failed to toggle check' }, 500)
  }
})
