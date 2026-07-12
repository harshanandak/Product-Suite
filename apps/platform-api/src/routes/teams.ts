import { Hono } from 'hono'

import type { Team } from '@product-suite/contracts'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'
import { recordWrite } from '../provenance/record-write'

/** Row shape from the tenant-scoped teams query (snake_case DB columns). */
interface TeamRow {
  id: string
  tenant_id: string
  name: string
  created_at: string | Date
  updated_at: string | Date
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

/** Input to create a team. `name` is required. */
interface CreateTeamBody {
  name?: string
}

export const teamsRoutes = new Hono<AuthedEnv>()

/**
 * List the teams the caller can see — tenant-scoped through the team's own
 * `tenant_id` (the org) to the tenants the caller is an active member of. The
 * caller is resolved from their Clerk identity (`claims.subject`) via the
 * Alembic-owned `user_auth_identities` → `organization_memberships` chain, so
 * this leaks nothing across tenants even though it queries the shared DB.
 */
teamsRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  let rows: TeamRow[]
  try {
    rows = (await sql`
      select t.id, t.tenant_id, t.name, t.created_at, t.updated_at
      from teams t
      where t.tenant_id in (
        select om.tenant_id
        from organization_memberships om
        join user_auth_identities uai on uai.user_id = om.user_id
        where uai.provider = 'clerk'
          and uai.provider_user_id = ${claims.subject}
          and om.status = 'active'
      )
      order by t.name
    `) as TeamRow[]
  } catch (cause) {
    console.error('[teams] list query failed', cause)
    return c.json({ error: 'Failed to load teams' }, 500)
  }

  return c.json(rows.map(toTeam))
})

/**
 * Create a team in the caller's org. The target org is the caller's single active
 * tenant — unambiguous now that org = workspace. Rejects when the caller is in no
 * org (403) or in several (400, ambiguous), or when `name` is missing (400). The
 * insert is tenant-anchored, so a team can never be created in another org.
 */
teamsRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const body = (await c.req.json().catch(() => ({}))) as CreateTeamBody

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

    // The human actor for provenance. Any caller who passed tenant scoping above
    // has a resolvable user id (same `user_auth_identities` row); a null here is a
    // server-side integrity anomaly, not a client error.
    const actorId = await callerUserId(sql, claims)
    if (!actorId) {
      console.error('[teams] create: tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to create team' }, 500)
    }

    // Provenance is stamped by recordWrite from the server-derived actor; only the
    // allowlisted `tenant_id`/`name` are passed, and `actor_*` can never be
    // supplied by the caller (the body is read field-by-field, never spread).
    const created = await recordWrite<TeamRow>(
      sql,
      'teams',
      { tenant_id: tenantId, name },
      { actorType: 'human', actorId },
    )
    return c.json(toTeam(created), 201)
  } catch (cause) {
    console.error('[teams] create failed', cause)
    return c.json({ error: 'Failed to create team' }, 500)
  }
})
