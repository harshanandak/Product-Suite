import { Hono } from 'hono'

import type { ActivityEvent, WorkItem, WorkItemPatch } from '@product-suite/contracts'

import { callerTenantIds } from '../auth/tenant-scope'
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
  team_id: string
  status_id: string
  parent_id: string | null
  depth: number
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
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length > 1) {
      return c.json({ error: 'Ambiguous organization' }, 400)
    }
    const tenantId = tenantIds[0]
    if (!tenantId) {
      return c.json({ error: 'No active organization' }, 403)
    }

    // team_id is mandatory and must be one of the caller's org's teams. Never
    // trust the client id: a team from another tenant fails this guard and is
    // rejected as unknown (no cross-tenant leak).
    if (!body.team_id) {
      return c.json({ error: 'team_id is required' }, 400)
    }
    const ownedTeam = (await sql`
      select 1 from teams where id = ${body.team_id} and tenant_id = ${tenantId}
    `) as unknown[]
    if (ownedTeam.length === 0) {
      return c.json({ error: 'Unknown team' }, 400)
    }

    // status_id is mandatory and must be a status of the SAME team. Never trust
    // the client id: a status from another team (or tenant) fails this guard and
    // is rejected as unknown (no cross-team/tenant leak). The team was just
    // verified in-tenant, so matching on team_id also confines it to the tenant.
    if (!body.status_id) {
      return c.json({ error: 'status_id is required' }, 400)
    }
    const ownedStatus = (await sql`
      select 1 from statuses where id = ${body.status_id} and team_id = ${body.team_id}
    `) as unknown[]
    if (ownedStatus.length === 0) {
      return c.json({ error: 'Unknown status' }, 400)
    }

    if (body.project_id != null) {
      const owned = (await sql`
        select 1 from projects where id = ${body.project_id} and tenant_id = ${tenantId}
      `) as unknown[]
      if (owned.length === 0) {
        return c.json({ error: 'Unknown project' }, 400)
      }
    }

    // parent_id is OPTIONAL — supplying it makes this a Task (a work item with a
    // parent). When present it must resolve to a parent that is (a) in the same
    // tenant, (b) on the SAME team (a Task inherits its parent's team — a
    // different team_id is rejected, not silently coerced, for clarity), and (c)
    // itself top-level. (c) is the DEPTH CAP = 1: the default MODE POLICY,
    // hardcoded here until modes exist (imports may bypass it and land deeper
    // trees). depth is server-derived (1 under a parent, else 0) — never trusted
    // from the body.
    let depth = 0
    if (body.parent_id != null) {
      const parentRows = (await sql`
        select team_id, parent_id from work_items
        where id = ${body.parent_id} and tenant_id = ${tenantId}
      `) as { team_id: string; parent_id: string | null }[]
      const parent = parentRows[0]
      if (!parent) {
        return c.json({ error: 'Unknown parent' }, 400)
      }
      if (parent.team_id !== body.team_id) {
        return c.json({ error: 'parent belongs to a different team' }, 400)
      }
      if (parent.parent_id != null) {
        return c.json({ error: 'max nesting depth is 1' }, 400)
      }
      depth = 1
    }

    const rows = (await sql`
      insert into work_items
        (tenant_id, title, description, phase, type, priority, tags, source,
         project_id, team_id, status_id, parent_id, depth, department, assignee_id, due_date, archived)
      values
        (${tenantId}, ${body.title ?? 'Untitled work item'}, ${body.description ?? ''},
         ${body.phase ?? 'plan'}, ${body.type ?? 'feature'}, ${body.priority ?? 'medium'},
         ${body.tags ?? []}, 'manual', ${body.project_id ?? null}, ${body.team_id},
         ${body.status_id}, ${body.parent_id ?? null}, ${depth}, ${body.department ?? 'General'},
         ${body.assignee_id ?? null}, ${body.due_date ?? null}, ${body.archived ?? false})
      returning *
    `) as WorkItemRow[]
    const created = rows[0]
    if (!created) {
      return c.json({ error: 'Failed to create work item' }, 500)
    }

    await sql`
      insert into activity_events (work_item_id, kind, summary)
      values (${created.id}, 'created', ${`Created “${created.title}”`})
    `
    return c.json(toWorkItem(created), 201)
  } catch (cause) {
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

    await sql`
      insert into activity_events (work_item_id, kind, summary)
      values (${id}, 'updated', ${summarizeUpdate(patch)})
    `
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
