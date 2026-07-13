import { Hono } from 'hono'

import { STATUS_CATEGORY_VALUES, type Status, type StatusCategory } from '@product-suite/contracts'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'
import { recordWrite } from '../provenance/record-write'

/** Row shape from the tenant-scoped statuses query (snake_case DB columns). */
interface StatusRow {
  id: string
  team_id: string
  name: string
  category: StatusCategory
  position: number
  created_at: string | Date
  updated_at: string | Date
}

function toStatus(row: StatusRow): Status {
  return {
    id: row.id,
    team_id: row.team_id,
    name: row.name,
    category: row.category,
    position: Number(row.position),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

/** Input to create a status. `team_id`, `name`, and `category` are required. */
interface CreateStatusBody {
  team_id?: string
  name?: string
  category?: string
  position?: number
}

const CATEGORIES = new Set<string>(STATUS_CATEGORY_VALUES)

export const statusesRoutes = new Hono<AuthedEnv>()

/**
 * List a team's workflow statuses, ordered by `position`. Tenant-scoped: the
 * `team_id` query param must name a team in one of the caller's *active* orgs —
 * the team's own `tenant_id` is joined to the caller's memberships, so a team
 * from another tenant simply yields an empty list (indistinguishable from an
 * empty team → no cross-tenant leak). `team_id` is required (400 when absent).
 */
statusesRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const teamId = c.req.query('team_id')

  if (!teamId) {
    return c.json({ error: 'team_id is required' }, 400)
  }

  let rows: StatusRow[]
  try {
    rows = (await sql`
      select s.id, s.team_id, s.name, s.category, s.position, s.created_at, s.updated_at
      from statuses s
      join teams t on t.id = s.team_id
      where s.team_id = ${teamId}
        and t.tenant_id in (
          select om.tenant_id
          from organization_memberships om
          join user_auth_identities uai on uai.user_id = om.user_id
          where uai.provider = 'clerk'
            and uai.provider_user_id = ${claims.subject}
            and om.status = 'active'
        )
      order by s.position, s.name
    `) as StatusRow[]
  } catch (cause) {
    console.error('[statuses] list query failed', cause)
    return c.json({ error: 'Failed to load statuses' }, 500)
  }

  return c.json(rows.map(toStatus))
})

/**
 * Add a status to one of the caller's teams. `team_id` must name a team in one of
 * the caller's active orgs (never trusted from the client: a team from another
 * tenant fails the ownership guard and is rejected as unknown, no leak). `name`
 * and `category` are required; `category` must be a valid {@link StatusCategory}.
 * `name` is unique per team (a duplicate surfaces as a 409).
 */
statusesRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const body = (await c.req.json().catch(() => ({}))) as CreateStatusBody

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'No active organization' }, 403)
    }

    if (!body.team_id) {
      return c.json({ error: 'team_id is required' }, 400)
    }
    const name = body.name?.trim()
    if (!name) {
      return c.json({ error: 'name is required' }, 400)
    }
    if (!body.category || !CATEGORIES.has(body.category)) {
      return c.json({ error: 'Invalid category' }, 400)
    }

    // The team must belong to one of the caller's orgs — never trust the id.
    const ownedTeam = (await sql`
      select 1 from teams where id = ${body.team_id} and tenant_id = any(${tenantIds})
    `) as unknown[]
    if (ownedTeam.length === 0) {
      return c.json({ error: 'Unknown team' }, 400)
    }

    const position = Number.isFinite(body.position) ? Number(body.position) : 0
    // The human actor for provenance (resolves for any caller past tenant scoping).
    const actorId = await callerUserId(sql, claims)
    if (!actorId) {
      console.error('[statuses] create: tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to create status' }, 500)
    }
    let created: StatusRow
    try {
      created = await recordWrite<StatusRow>(
        sql,
        {
          table: 'statuses',
          operation: 'insert',
          values: { team_id: body.team_id, name, category: body.category, position },
        },
        { actorType: 'human', actorId },
      )
    } catch (cause) {
      // Unique (team_id, name) violation → a friendly 409 (not a 500).
      const message = cause instanceof Error ? cause.message : String(cause)
      if (message.includes('statuses_team_name_uniq') || message.includes('duplicate key')) {
        return c.json({ error: 'A status with that name already exists' }, 409)
      }
      throw cause
    }
    if (!created) {
      return c.json({ error: 'Failed to create status' }, 500)
    }
    return c.json(toStatus(created), 201)
  } catch (cause) {
    console.error('[statuses] create failed', cause)
    return c.json({ error: 'Failed to create status' }, 500)
  }
})
