import { Hono } from 'hono'

import type { ActivityEvent, AuthClaims, WorkItem, WorkItemPatch } from '@product-suite/contracts'

import type { Sql } from '@product-suite/db'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import { DomainError, domainErrorStatus } from '../domain/errors'
import { createWorkItem, type WorkItemRow } from '../domain/work-items'
import type { AuthedEnv } from '../middleware/clerk-auth'
import { actorAssignments, recordWrite, type ActorContext } from '../provenance/record-write'

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

/** One-line activity summary for a work-item update (most-relevant field wins). */
function summarizeUpdate(patch: WorkItemPatch): string {
  if (patch.phase) return `Phase set to ${patch.phase}`
  if (patch.title !== undefined) return `Renamed to “${patch.title}”`
  if (patch.priority) return `Priority set to ${patch.priority}`
  if (patch.archived !== undefined) return patch.archived ? 'Archived' : 'Unarchived'
  const fields = Object.keys(patch)
  return fields.length > 0 ? `Updated ${fields.join(', ')}` : 'Updated'
}

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
 * is in no org (403) or in several (400, ambiguous). `team_id` is REQUIRED and
 * must belong to the same org (a team from another tenant is indistinguishable
 * from an unknown one → 400, no leak). A `project_id`, if given, must likewise
 * belong to the same org.
 */
workItemsRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const body = (await c.req.json().catch(() => ({}))) as CreateWorkItemBody

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
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'Not found' }, 404)
    }

    const existing = (await sql`
      select * from work_items where id = ${id} and tenant_id = any(${tenantIds})
    `) as WorkItemRow[]
    const current = existing[0]
    if (!current) {
      return c.json({ error: 'Not found' }, 404)
    }

    if (patch.team_id != null) {
      const ownedTeam = (await sql`
        select 1 from teams where id = ${patch.team_id} and tenant_id = any(${tenantIds})
      `) as unknown[]
      if (ownedTeam.length === 0) {
        return c.json({ error: 'Unknown team' }, 400)
      }
      // A Task and its parent must share a team, so an item that is part of a
      // hierarchy cannot change team on its own — either side would strand the
      // other. Reject a team move while the item is a child (has a parent) OR a
      // parent (has children). Detach the hierarchy first, then move.
      if (patch.team_id !== current.team_id) {
        if (current.parent_id != null) {
          return c.json({ error: 'cannot change a sub-item’s team; re-parent or unparent it first' }, 400)
        }
        const kids = (await sql`
          select 1 from work_items where parent_id = ${id} limit 1
        `) as unknown[]
        if (kids.length > 0) {
          return c.json({ error: 'cannot change the team of an item with sub-items; move or detach them first' }, 400)
        }
      }
    }

    // A reassigned status must belong to the item's (possibly newly-set) team.
    // The effective team is the patched team if present, else the current one —
    // both already confined to the caller's tenant, so matching on team_id keeps
    // the status in-tenant too.
    if (patch.status_id != null) {
      const effectiveTeamId = patch.team_id ?? current.team_id
      const ownedStatus = (await sql`
        select 1 from statuses where id = ${patch.status_id} and team_id = ${effectiveTeamId}
      `) as unknown[]
      if (ownedStatus.length === 0) {
        return c.json({ error: 'Unknown status' }, 400)
      }
    }

    if (patch.project_id != null) {
      const owned = (await sql`
        select 1 from projects where id = ${patch.project_id} and tenant_id = any(${tenantIds})
      `) as unknown[]
      if (owned.length === 0) {
        return c.json({ error: 'Unknown project' }, 400)
      }
    }

    // parent_id patch: SETTING a parent establishes the Task tier; CLEARING it
    // (explicit null) promotes the item back to top-level. Absent ⇒ unchanged.
    // Same-tenant + same-team + depth-cap-1 guards as create (the effective team
    // is the patched team if reassigned, else the item's current one). Self-parent
    // is rejected here; a proposed parent that is already a descendant is caught by
    // the depth cap (it would have a parent) AND, as a race backstop, by the
    // recursive-ancestors guard folded into the UPDATE below. depth is derived
    // (0 when cleared, 1 under a parent) — never trusted from the body.
    let nextParentId: string | null = current.parent_id
    let nextDepth = current.depth
    const settingParent = 'parent_id' in patch && patch.parent_id != null
    if ('parent_id' in patch) {
      if (patch.parent_id == null) {
        nextParentId = null
        nextDepth = 0
      } else {
        if (patch.parent_id === id) {
          return c.json({ error: 'A work item cannot be its own parent' }, 400)
        }
        // Depth cap (child side): an item that already HAS children cannot itself
        // be nested — that would create a depth-2 tree (grandchildren) past the
        // native cap of 1. Reject; the user must first move/detach the children.
        const childRows = (await sql`
          select 1 from work_items where parent_id = ${id} limit 1
        `) as unknown[]
        if (childRows.length > 0) {
          return c.json({ error: 'cannot nest an item that has its own sub-items' }, 400)
        }
        const effectiveTeamId = patch.team_id ?? current.team_id
        const parentRows = (await sql`
          select team_id, parent_id from work_items
          where id = ${patch.parent_id} and tenant_id = any(${tenantIds})
        `) as { team_id: string; parent_id: string | null }[]
        const parent = parentRows[0]
        if (!parent) {
          return c.json({ error: 'Unknown parent' }, 400)
        }
        if (parent.team_id !== effectiveTeamId) {
          return c.json({ error: 'parent belongs to a different team' }, 400)
        }
        if (parent.parent_id != null) {
          return c.json({ error: 'max nesting depth is 1' }, 400)
        }
        nextParentId = patch.parent_id
        nextDepth = 1
      }
    }

    const next = { ...current, ...patch }
    // The parent-set is folded into this single UPDATE with a WHERE NOT EXISTS
    // reachability guard — the same one-statement approach documented in
    // routes/dependencies.ts. It closes the check-then-write gap where a concurrent
    // request commits a reaching path between our pre-check and this write. It does
    // NOT fully serialize: two concurrent complementary sets (A→B and B→A) can each
    // pass under READ COMMITTED (neither sees the other's uncommitted row) and form
    // a 2-cycle; closing that needs SERIALIZABLE (sql.transaction). Acceptable while
    // parent writes are low-volume (revisit if that changes). When no parent is
    // being set (${nextParentId} is null) the guard is a no-op.
    // Tier-2 escape hatch: this update carries the recursive-CTE cycle guard and an
    // array-scoped tenant match, so it keeps its own SQL and stamps all four actor_*
    // columns inline — on the OUTER update's SET, never inside the ancestors CTE.
    const actorId = await callerUserId(sql, claims)
    if (!actorId) {
      console.error('[work-items] update: tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to update work item' }, 500)
    }
    const actor = actorAssignments({ actorType: 'human', actorId })

    const rows = (await sql`
      update work_items set
        title = ${next.title},
        description = ${next.description ?? ''},
        phase = ${next.phase},
        type = ${next.type},
        priority = ${next.priority},
        tags = ${next.tags ?? []},
        project_id = ${next.project_id ?? null},
        team_id = ${next.team_id},
        status_id = ${next.status_id},
        parent_id = ${nextParentId},
        depth = ${nextDepth},
        department = ${next.department},
        assignee_id = ${next.assignee_id ?? null},
        due_date = ${next.due_date ?? null},
        archived = ${next.archived ?? false},
        actor_type = ${actor.actorType},
        actor_id = ${actor.actorId},
        on_behalf_of = ${actor.onBehalfOf},
        run_id = ${actor.runId},
        updated_at = now()
      where id = ${id} and tenant_id = any(${tenantIds})
        and (
          ${nextParentId}::uuid is null
          or not exists (
            with recursive ancestors(id) as (
              select parent_id as id from work_items
                where id = ${nextParentId} and parent_id is not null
              union
              select w.parent_id as id from work_items w
                join ancestors a on w.id = a.id
                where w.parent_id is not null
            )
            select 1 from ancestors where id = ${id}
          )
        )
      returning *
    `) as WorkItemRow[]
    const updated = rows[0]
    if (!updated) {
      // The row exists (fetched above) — a no-match now means the reachability
      // guard blocked a parent-set that would close a cycle. Otherwise it is a
      // genuine not-found (e.g. a concurrent delete).
      if (settingParent) {
        return c.json({ error: 'parent_id would create a cycle' }, 400)
      }
      return c.json({ error: 'Not found' }, 404)
    }

    // The activity event is a separate (non-atomic) write here — it runs only when
    // the update above matched, so it can't share the conditional update's batch
    // (Neon HTTP has no interactive txn). Ordered update-first/event-second: the
    // only failure mode is a missing event, never a phantom one. Stamped via recordWrite.
    await recordWrite(
      sql,
      {
        table: 'activity_events',
        operation: 'insert',
        values: { work_item_id: id, kind: 'updated', summary: summarizeUpdate(patch) },
      },
      { actorType: 'human', actorId },
    )
    return c.json(toWorkItem(updated))
  } catch (cause) {
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
