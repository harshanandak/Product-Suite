import { Hono } from 'hono'

import type { ActivityEvent, AuthClaims, WorkItem, WorkItemPatch } from '@product-suite/contracts'

import type { Sql } from '@product-suite/db'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import { DomainError, domainErrorStatus } from '../domain/errors'
import { createWorkItem, updateWorkItem, type WorkItemRow } from '../domain/work-items'
import type { AuthedEnv } from '../middleware/clerk-auth'
import type { ActorContext } from '../provenance/record-write'

/**
 * Resolve the human actor for a write, LAZILY: the caller's internal user id is
 * looked up only after the domain command has run its ownership validation, so the
 * validation's DB queries keep their original ordering. A missing user id is a
 * server-side integrity anomaly (any caller past tenant scoping resolves one), so
 * it throws a plain Error → mapped to 500 at the route's catch, never a 4xx.
 */
async function resolveHumanActor(sql: Sql, claims: AuthClaims): Promise<ActorContext> {
  const actorId = await callerUserId(sql, claims)
  if (!actorId) {
    console.error('[work-items] tenant resolved but no user identity for subject')
    throw new Error('no attributable actor')
  }
  return { actorType: 'human', actorId }
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
    team_id: row.team_id,
    status_id: row.status_id,
    parent_id: row.parent_id ?? null,
    depth: row.depth ?? 0,
    department: row.department,
    assignee_id: row.assignee_id,
    due_date: row.due_date == null ? null : String(row.due_date),
    archived: row.archived ?? false,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

/** Row shape from the activity_events query (snake_case DB columns). */
interface ActivityRow {
  id: string
  work_item_id: string
  kind: ActivityEvent['kind']
  summary: string
  created_at: string | Date
}

function toActivityEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    work_item_id: row.work_item_id,
    kind: row.kind,
    summary: row.summary,
    created_at: String(row.created_at),
  }
}

/** Editable fields accepted on create (the update patch + an explicit title). */
type CreateWorkItemBody = { title?: string } & Partial<WorkItemPatch>

export const workItemsRoutes = new Hono<AuthedEnv>()

/**
 * List the work items the caller can see. Tenant-scoped: only items whose own
 * `tenant_id` (the org) is one the caller is an *active* member of. The caller is
 * resolved from their Clerk identity (`claims.subject`) via the Alembic-owned
 * `user_auth_identities` -> `organization_memberships` chain, so this leaks
 * nothing across tenants even though it queries the shared DB.
 */
workItemsRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  let rows: WorkItemRow[]
  try {
    rows = (await sql`
      select wi.id, wi.title, wi.description, wi.phase, wi.type, wi.priority, wi.tags,
             wi.source, wi.project_id, wi.team_id, wi.status_id, wi.parent_id, wi.depth,
             wi.department, wi.assignee_id,
             wi.due_date, wi.archived, wi.created_at, wi.updated_at
      from work_items wi
      where wi.tenant_id in (
        select om.tenant_id
        from organization_memberships om
        join user_auth_identities uai on uai.user_id = om.user_id
        where uai.provider = 'clerk'
          and uai.provider_user_id = ${claims.subject}
          and om.status = 'active'
      )
      order by wi.updated_at desc
    `) as WorkItemRow[]
  } catch (cause) {
    console.error('[work-items] list query failed', cause)
    return c.json({ error: 'Failed to load work items' }, 500)
  }

  return c.json(rows.map(toWorkItem))
})

/**
 * Create a work item in the caller's org. The target org is the caller's single
 * active tenant — unambiguous now that org = workspace. Rejects when the caller
 * is in no org (403) or in several (400, ambiguous). `team_id` is OPTIONAL: when
 * omitted it defaults to the caller's sole team, so a single-team workspace never
 * has to name its team; a tenant with multiple teams gets a clear 400 (ambiguous)
 * and a tenant with no team a clear 400. When supplied it must belong to the same
 * org (a team from another tenant is indistinguishable from an unknown one → 400,
 * no leak). A `project_id`, if given, must likewise belong to the same org.
 */
workItemsRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  // Distinguish a genuinely-empty body (default a new item — acceptable) from
  // MALFORMED JSON. Read the raw text first: an empty/whitespace body becomes {}
  // (defaults apply), but a non-empty body that fails to parse — or parses to a
  // non-object — is a 400, never silently swallowed to {} (which, now that team_id
  // defaults, would create a stray "Untitled work item" in a single-team tenant).
  const raw = (await c.req.text()).trim()
  let body: CreateWorkItemBody
  if (raw === '') {
    body = {}
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return c.json({ error: 'Malformed JSON body' }, 400)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return c.json({ error: 'Malformed JSON body' }, 400)
    }
    body = parsed as CreateWorkItemBody
  }

  try {
    // The target org is the caller's single active tenant (ambiguity/absence are
    // the route's concern); the domain command owns every other invariant.
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length > 1) {
      return c.json({ error: 'Ambiguous organization' }, 400)
    }
    const tenantId = tenantIds[0]
    if (!tenantId) {
      return c.json({ error: 'No active organization' }, 403)
    }

    const created = await createWorkItem(
      sql,
      { tenantId, actor: () => resolveHumanActor(sql, claims) },
      body,
    )
    return c.json(toWorkItem(created), 201)
  } catch (cause) {
    if (cause instanceof DomainError) {
      return c.json({ error: cause.message }, domainErrorStatus(cause.code))
    }
    console.error('[work-items] create failed', cause)
    return c.json({ error: 'Failed to create work item' }, 500)
  }
})

/**
 * Update a work item. The mutation is guarded: the row is fetched scoped to the
 * caller's orgs first (404 if not theirs), the patch merged, then written back
 * with the same tenant guard in the WHERE — so a caller can never mutate another
 * org's item even by guessing its id.
 */
workItemsRoutes.patch('/:id', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')
  const patch = (await c.req.json().catch(() => ({}))) as WorkItemPatch

  try {
    // No active org ⇒ the item can't be theirs (short-circuit before any read,
    // indistinguishable from not-found — no leak). Every other invariant, the
    // scoped fetch, and the cycle-guarded write live in the domain command.
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const updated = await updateWorkItem(
      sql,
      { tenantIds, actor: () => resolveHumanActor(sql, claims) },
      id,
      patch,
    )
    return c.json(toWorkItem(updated))
  } catch (cause) {
    if (cause instanceof DomainError) {
      return c.json({ error: cause.message }, domainErrorStatus(cause.code))
    }
    console.error('[work-items] update failed', cause)
    return c.json({ error: 'Failed to update work item' }, 500)
  }
})

/**
 * The activity feed for one work item (newest first). Guarded: the caller must
 * own the work item (else 404, indistinguishable from not-found — no leak).
 */
workItemsRoutes.get('/:id/activity', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const owned = (await sql`
      select 1 from work_items where id = ${id} and tenant_id = any(${tenantIds})
    `) as unknown[]
    if (owned.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const rows = (await sql`
      select id, work_item_id, kind, summary, created_at
      from activity_events
      where work_item_id = ${id}
      order by created_at desc, id desc
    `) as ActivityRow[]
    return c.json(rows.map(toActivityEvent))
  } catch (cause) {
    console.error('[work-items] activity query failed', cause)
    return c.json({ error: 'Failed to load activity' }, 500)
  }
})
