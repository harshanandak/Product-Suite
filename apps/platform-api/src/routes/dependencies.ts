import { Hono } from 'hono'

import type { WorkItemDependency } from '@product-suite/contracts'

import { callerTenantIds } from '../auth/tenant-scope'
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

/** Input to create a dependency edge (`source` depends on `target`). */
interface AddDependencyBody {
  source_item_id?: string
  target_item_id?: string
  relationship_type?: WorkItemDependency['relationship_type']
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

/** True for a Postgres unique-violation error (SQLSTATE 23505). */
function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: string }).code === '23505'
  )
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

/**
 * Create a directed dependency `source → target` ("source depends on target").
 * Guarded + validated exactly like the mock so the graph stays a DAG:
 *  - both items must exist and belong to the SAME org the caller is in (404),
 *  - no self-loop (400),
 *  - no duplicate edge (409, via the unique constraint),
 *  - no cycle (409) — checked with a recursive reachability walk before insert.
 */
dependenciesRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const body = (await c.req.json().catch(() => ({}))) as AddDependencyBody

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const source = body.source_item_id
    const target = body.target_item_id
    if (!source || !target) {
      return c.json({ error: 'source_item_id and target_item_id are required' }, 400)
    }
    if (source === target) {
      return c.json({ error: 'A work item cannot depend on itself' }, 400)
    }

    // Both endpoints must exist and be in one of the caller's orgs.
    const items = (await sql`
      select id, tenant_id from work_items
      where id in (${source}, ${target}) and tenant_id = any(${tenantIds})
    `) as { id: string; tenant_id: string }[]
    const first = items[0]
    if (items.length !== 2 || !first || items.some((i) => i.tenant_id !== first.tenant_id)) {
      // Missing, not owned, or split across two orgs — no edge, no leak.
      return c.json({ error: 'Not found' }, 404)
    }
    const tenantId = first.tenant_id

    // Adding source → target closes a cycle iff `target` already reaches `source`
    // by following existing dependency edges (within this org).
    const cyclic = (await sql`
      with recursive reachable(id) as (
        select target_item_id from work_item_dependencies
          where source_item_id = ${target} and tenant_id = ${tenantId}
        union
        select d.target_item_id
          from work_item_dependencies d
          join reachable r on d.source_item_id = r.id
          where d.tenant_id = ${tenantId}
      )
      select 1 from reachable where id = ${source} limit 1
    `) as unknown[]
    if (cyclic.length > 0) {
      return c.json({ error: 'Dependency would create a cycle' }, 409)
    }

    let rows: DependencyRow[]
    try {
      rows = (await sql`
        insert into work_item_dependencies
          (tenant_id, source_item_id, target_item_id, relationship_type)
        values (${tenantId}, ${source}, ${target}, ${body.relationship_type ?? 'depends_on'})
        returning id, source_item_id, target_item_id, relationship_type, created_at
      `) as DependencyRow[]
    } catch (cause) {
      if (isUniqueViolation(cause)) {
        return c.json({ error: 'Dependency already exists' }, 409)
      }
      throw cause
    }
    const created = rows[0]
    if (!created) {
      return c.json({ error: 'Failed to create dependency' }, 500)
    }
    return c.json(toDependency(created), 201)
  } catch (cause) {
    console.error('[dependencies] create failed', cause)
    return c.json({ error: 'Failed to create dependency' }, 500)
  }
})

/**
 * Remove a dependency edge by id. Scoped to the caller's orgs — a 404 covers both
 * "no such edge" and "not yours" (indistinguishable, no leak).
 */
dependenciesRoutes.delete('/:id', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }
    const rows = (await sql`
      delete from work_item_dependencies
      where id = ${id} and tenant_id = any(${tenantIds})
      returning id
    `) as { id: string }[]
    if (rows.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.body(null, 204)
  } catch (cause) {
    console.error('[dependencies] delete failed', cause)
    return c.json({ error: 'Failed to remove dependency' }, 500)
  }
})
