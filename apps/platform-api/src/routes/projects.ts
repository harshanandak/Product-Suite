import { Hono } from 'hono'

import { PROJECT_STATUS_VALUES, type Project, type ProjectStatus } from '@product-suite/contracts'

import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/** Row shape from the tenant-scoped projects query (snake_case DB columns). */
interface ProjectRow {
  id: string
  name: string
  kind: string
  status: ProjectStatus
  lead_id: string | null
  target_date: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    lead_id: row.lead_id,
    target_date: row.target_date == null ? null : String(row.target_date),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

/** True when `value` is one of the closed {@link ProjectStatus} set. */
function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUS_VALUES as readonly string[]).includes(value)
}

/** Input to create a project. `name` is required; `status` defaults to `backlog`. */
interface CreateProjectBody {
  name?: string
  kind?: string
  status?: string
  lead_id?: string | null
  target_date?: string | null
}

/** Input to update a project — every field optional (absent ⇒ unchanged). */
interface UpdateProjectBody {
  name?: string
  kind?: string
  status?: string
  lead_id?: string | null
  target_date?: string | null
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
      select p.id, p.name, p.kind, p.status, p.lead_id, p.target_date,
             p.created_at, p.updated_at
      from projects p
      where p.tenant_id in (
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

/**
 * Create a project in the caller's org. The target org is the caller's single
 * active tenant — unambiguous now that org = workspace. Rejects when the caller
 * is in no org (403) or in several (400, ambiguous), when `name` is missing
 * (400), or when a supplied `status` is not a known {@link ProjectStatus} (400).
 * `status` defaults to `backlog`. The insert is tenant-anchored, so a project can
 * never be created in another org. `lead_id` mirrors work-item `assignee_id`
 * rigor — stored as given (the DB FK to users(id) is the backstop), not validated
 * for tenant membership here.
 */
projectsRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const body = (await c.req.json().catch(() => ({}))) as CreateProjectBody

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length > 1) {
      return c.json({ error: 'Ambiguous organization' }, 400)
    }
    const tenantId = tenantIds[0]
    if (!tenantId) {
      return c.json({ error: 'No active organization' }, 403)
    }

    const name = body.name?.trim()
    if (!name) {
      return c.json({ error: 'name is required' }, 400)
    }

    if (body.status !== undefined && !isProjectStatus(body.status)) {
      return c.json({ error: 'Unknown status' }, 400)
    }
    const status: ProjectStatus = body.status ?? 'backlog'
    const kind = body.kind?.trim() || 'general'

    const rows = (await sql`
      insert into projects (tenant_id, name, kind, status, lead_id, target_date)
      values (${tenantId}, ${name}, ${kind}, ${status},
              ${body.lead_id ?? null}, ${body.target_date ?? null})
      returning id, name, kind, status, lead_id, target_date, created_at, updated_at
    `) as ProjectRow[]
    const created = rows[0]
    if (!created) {
      return c.json({ error: 'Failed to create project' }, 500)
    }
    return c.json(toProject(created), 201)
  } catch (cause) {
    console.error('[projects] create failed', cause)
    return c.json({ error: 'Failed to create project' }, 500)
  }
})

/**
 * Update a project. Guarded exactly like the work-item patch: the row is fetched
 * scoped to the caller's orgs first (404 if not theirs), then written back with
 * the same tenant guard in the WHERE — so a caller can never mutate another org's
 * project even by guessing its id. A supplied unknown `status` is rejected (400).
 * Absent fields are left unchanged; `lead_id`/`target_date` accept explicit
 * `null` to clear.
 */
projectsRoutes.patch('/:id', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as UpdateProjectBody

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const existing = (await sql`
      select id, name, kind, status, lead_id, target_date, created_at, updated_at
      from projects where id = ${id} and tenant_id = any(${tenantIds})
    `) as ProjectRow[]
    const current = existing[0]
    if (!current) {
      return c.json({ error: 'Not found' }, 404)
    }

    if (body.status !== undefined && !isProjectStatus(body.status)) {
      return c.json({ error: 'Unknown status' }, 400)
    }

    const next = {
      name: body.name !== undefined ? body.name : current.name,
      kind: body.kind !== undefined ? body.kind : current.kind,
      status: body.status !== undefined ? (body.status as ProjectStatus) : current.status,
      lead_id: 'lead_id' in body ? (body.lead_id ?? null) : current.lead_id,
      target_date: 'target_date' in body ? (body.target_date ?? null) : current.target_date,
    }

    const rows = (await sql`
      update projects set
        name = ${next.name},
        kind = ${next.kind},
        status = ${next.status},
        lead_id = ${next.lead_id},
        target_date = ${next.target_date},
        updated_at = now()
      where id = ${id} and tenant_id = any(${tenantIds})
      returning id, name, kind, status, lead_id, target_date, created_at, updated_at
    `) as ProjectRow[]
    const updated = rows[0]
    if (!updated) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(toProject(updated))
  } catch (cause) {
    console.error('[projects] update failed', cause)
    return c.json({ error: 'Failed to update project' }, 500)
  }
})
