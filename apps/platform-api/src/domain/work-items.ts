import type { Sql } from '@product-suite/db'

import type { WorkItem, WorkItemPatch } from '@product-suite/contracts'

import { actorAssignments, recordWrite, recordWriteTx, type ActorContext } from '../provenance/record-write'
import { DomainError } from './errors'

/**
 * Row shape returned by the tenant-scoped work_items query (snake_case DB
 * columns). Shared with the routes (which map it to the contract via
 * `toWorkItem`) and the proposals-apply path.
 */
export interface WorkItemRow {
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

/**
 * The server-derived actor, supplied either eagerly (an already-resolved
 * `ActorContext`, e.g. the agent actor on the apply path) or LAZILY as a thunk.
 *
 * The lazy form is what the human routes use: the caller's internal user id is
 * resolved via `callerUserId` (one DB round-trip), but only AFTER the command's
 * ownership validation has run — so the validation's DB calls keep their original
 * ordering (the extraction relocates the logic without reordering its queries).
 * The thunk throws (a plain Error → 500 at the edge) when no attributable user
 * exists, preserving the pre-extraction behavior.
 */
export type ActorSource = ActorContext | (() => Promise<ActorContext>)

async function resolveActor(source: ActorSource): Promise<ActorContext> {
  return typeof source === 'function' ? source() : source
}

/**
 * Editable fields accepted on create (the update patch + an explicit title).
 * `source` is provenance (excluded from the update patch), but a create MAY set it
 * so an agent-applied create can carry `source: 'agent'` from its payload; it
 * defaults to `'manual'` for a human create.
 */
export type CreateWorkItemInput = { title?: string; source?: WorkItem['source'] } & Partial<WorkItemPatch>

/**
 * Resolve a team's DEFAULT workflow status — the state a newly-created item lands
 * in when the caller omits `status_id`. The default is DERIVED from ordering (no
 * `is_default` flag to fall out of sync): the lowest-`position` status whose
 * category is NOT `triage`. `triage` is the reserved agent/integration inbox and
 * is never a human create-default, so it is excluded even when it sorts first;
 * ties on `position` break by `name` for determinism. This mirrors the phase→status
 * backfill (the default phase `plan` maps to the first non-triage status, e.g.
 * "Backlog"). Throws `no_default_status` when the team has no statuses at all — a
 * clear signal to add a status before creating items, not a generic 400. Callers
 * MUST have already verified `teamId` is one of the caller's teams (this does not
 * re-scope to the tenant; it trusts the prior team-ownership guard).
 */
export async function resolveDefaultStatusId(sql: Sql, teamId: string): Promise<string> {
  // SEAM: a future per-team "default status" workspace setting would override the
  // ordering-derived pick here — read the configured status_id first and only
  // fall back to the lowest-position non-triage status below when unset.
  const rows = (await sql`
    select id from statuses
    where team_id = ${teamId} and category <> 'triage'
    order by position, name
    limit 1
  `) as { id: string }[]
  const def = rows[0]
  if (!def) {
    throw new DomainError(
      'no_default_status',
      'team has no default status; add a status to this team before creating items',
    )
  }
  return def.id
}

/**
 * Resolve the team a create lands in when the caller OMITS `team_id`. Defaults
 * ONLY when the caller's tenant is unambiguous — EXACTLY ONE team — so a
 * single-team workspace never has to name its team. With MULTIPLE teams the
 * target is ambiguous, so we refuse with a clear 4xx (`team_required_multiple`)
 * rather than silently guessing which team an item belongs to; with ZERO teams
 * there is nothing to create into (`no_team`). Scoped to the caller's tenant, so
 * it can neither resolve nor leak another tenant's team.
 *
 * SEAM: a future "default team" workspace setting would override the single-team
 * shortcut here — pick the configured team before falling back to the count.
 */
export async function resolveDefaultTeamId(sql: Sql, tenantId: string): Promise<string> {
  // `limit 2` classifies none / one / many with a single read — one extra row is
  // all we need to know the tenant is ambiguous, without counting the whole table.
  const rows = (await sql`
    select id from teams where tenant_id = ${tenantId} order by id limit 2
  `) as { id: string }[]
  if (rows.length > 1) {
    throw new DomainError('team_required_multiple', 'multiple teams — specify team_id')
  }
  const team = rows[0]
  if (!team) {
    throw new DomainError(
      'no_team',
      'no team to create into; create a team before creating items',
    )
  }
  return team.id
}

/**
 * Create a work item in one org, through the single validated write path. Anchors
 * to the resolved `tenantId`. `team_id` is OPTIONAL on input: when supplied it is
 * verified in-tenant (a foreign id is indistinguishable from unknown → rejected,
 * no leak); when OMITTED it defaults to the caller's sole team, or raises a clear
 * 4xx when the tenant has multiple/zero teams (see {@link resolveDefaultTeamId}).
 * `status_id` is OPTIONAL on input: when supplied it must belong to the resolved
 * team; when OMITTED the team's DEFAULT status is resolved server-side (see
 * {@link resolveDefaultStatusId}) so the item always persists a valid team-scoped
 * `status_id`. An optional `parent_id` must be in-tenant, same-team, and top-level
 * (depth cap 1). The item + its `created` activity event are written as ONE atomic
 * Neon batch (`recordWriteTx`) with the id generated client-side, so the batch
 * stays non-interactive. Throws `DomainError` on any invariant violation.
 */
export async function createWorkItem(
  sql: Sql,
  ctx: { tenantId: string; actor: ActorSource; appliedFromProposalId?: string },
  input: CreateWorkItemInput,
): Promise<WorkItemRow> {
  const { tenantId } = ctx

  // team_id: SUPPLIED (present on input, even if blank/empty) it must be one of
  // the caller's org's teams — never trust the client id: a blank, unknown, or
  // cross-tenant id fails the ownership check → rejected as unknown_team (no
  // cross-tenant leak). Defaulting is triggered ONLY when the key is ABSENT
  // (=== undefined), so a provided-but-blank id rejects instead of silently
  // defaulting. When omitted, default to the caller's team ONLY if the tenant is
  // unambiguous (exactly one team); multiple or zero teams raise a clear 4xx
  // (see {@link resolveDefaultTeamId}).
  let teamId: string
  if (input.team_id === undefined) {
    teamId = await resolveDefaultTeamId(sql, tenantId)
  } else {
    teamId = input.team_id
    const ownedTeam = (await sql`
      select 1 from teams where id = ${teamId} and tenant_id = ${tenantId}
    `) as unknown[]
    if (ownedTeam.length === 0) throw new DomainError('unknown_team', 'Unknown team')
  }

  // status_id: SUPPLIED (present, even if blank/empty) it must be a status of the
  // SAME team (matching on team_id confines it to the tenant too — a blank,
  // cross-team, or unknown status is rejected as 'Unknown status', no leak).
  // Defaulting fires ONLY when the key is ABSENT (=== undefined); a
  // provided-but-blank status rejects instead of defaulting. When omitted, resolve
  // the team's DEFAULT status server-side instead of 400ing.
  let statusId: string
  if (input.status_id === undefined) {
    statusId = await resolveDefaultStatusId(sql, teamId)
  } else {
    statusId = input.status_id
    const ownedStatus = (await sql`
      select 1 from statuses where id = ${statusId} and team_id = ${teamId}
    `) as unknown[]
    if (ownedStatus.length === 0) throw new DomainError('unknown_status', 'Unknown status')
  }

  if (input.project_id != null) {
    const owned = (await sql`
      select 1 from projects where id = ${input.project_id} and tenant_id = ${tenantId}
    `) as unknown[]
    if (owned.length === 0) throw new DomainError('unknown_project', 'Unknown project')
  }

  // parent_id is OPTIONAL — supplying it makes this a Task. When present it must
  // resolve to a parent that is (a) in the same tenant, (b) on the SAME team, and
  // (c) itself top-level (depth cap = 1). depth is server-derived, never trusted.
  let depth = 0
  if (input.parent_id != null) {
    const parentRows = (await sql`
      select team_id, parent_id from work_items
      where id = ${input.parent_id} and tenant_id = ${tenantId}
    `) as { team_id: string; parent_id: string | null }[]
    const parent = parentRows[0]
    if (!parent) throw new DomainError('unknown_parent', 'Unknown parent')
    if (parent.team_id !== teamId)
      throw new DomainError('parent_different_team', 'parent belongs to a different team')
    if (parent.parent_id != null) throw new DomainError('max_depth', 'max nesting depth is 1')
    depth = 1
  }

  const actor = await resolveActor(ctx.actor)

  const workItemId = crypto.randomUUID()
  const title = input.title ?? 'Untitled work item'
  // Idempotency for the proposal-apply path (design §14): when this create is
  // driven by an accepted proposal, stamp `applied_from_proposal_id`. A UNIQUE
  // (non-null) index guarantees a re-drive after a crash between the proposal
  // claim and this write can't double-create — the unique violation is caught
  // below and the already-created row is returned instead. Absent for human
  // creates, so the column is simply omitted (NULLs don't collide).
  const workItemValues: Record<string, unknown> = {
    id: workItemId,
    tenant_id: tenantId,
    title,
    description: input.description ?? '',
    phase: input.phase ?? 'plan',
    type: input.type ?? 'feature',
    priority: input.priority ?? 'medium',
    tags: input.tags ?? [],
    source: input.source ?? 'manual',
    project_id: input.project_id ?? null,
    team_id: teamId,
    status_id: statusId,
    parent_id: input.parent_id ?? null,
    depth,
    department: input.department ?? 'General',
    assignee_id: input.assignee_id ?? null,
    due_date: input.due_date ?? null,
    archived: input.archived ?? false,
  }
  if (ctx.appliedFromProposalId != null) {
    workItemValues.applied_from_proposal_id = ctx.appliedFromProposalId
  }

  let created: WorkItemRow | undefined
  try {
    ;[created] = await recordWriteTx<WorkItemRow>(
      sql,
      [
        { table: 'work_items', operation: 'insert', values: workItemValues },
        {
          table: 'activity_events',
          operation: 'insert',
          values: {
            id: crypto.randomUUID(),
            work_item_id: workItemId,
            kind: 'created',
            summary: `Created “${title}”`,
          },
        },
      ],
      actor,
    )
  } catch (cause) {
    // Idempotent re-drive: a prior apply attempt already created this row. The
    // partial-unique index on `applied_from_proposal_id` rejected the duplicate —
    // fetch and return the existing row (NOT an error; the apply is exactly-once).
    const message = cause instanceof Error ? cause.message : String(cause)
    if (
      ctx.appliedFromProposalId != null &&
      (message.includes('work_items_applied_from_proposal_uniq') || message.includes('duplicate key'))
    ) {
      const existingRows = (await sql`
        select * from work_items where applied_from_proposal_id = ${ctx.appliedFromProposalId}
      `) as WorkItemRow[]
      const existing = existingRows[0]
      if (existing) return existing
    }
    throw cause
  }
  if (!created) throw new DomainError('not_found', 'insert returned no row')
  return created
}

/** One-line activity summary for a work-item update (most-relevant field wins). */
function summarizeUpdate(patch: WorkItemPatch): string {
  if (patch.phase) return `Phase set to ${patch.phase}`
  if (patch.title !== undefined) return `Renamed to “${patch.title}”`
  if (patch.priority) return `Priority set to ${patch.priority}`
  if (patch.archived !== undefined) return patch.archived ? 'Archived' : 'Unarchived'
  const fields = Object.keys(patch)
  return fields.length > 0 ? `Updated ${fields.join(', ')}` : 'Updated'
}

/** Editable fields accepted on update. */
export type UpdateWorkItemInput = WorkItemPatch

/**
 * Update a work item, through the single validated write path. The row is fetched
 * scoped to `tenantIds` first (`not_found` if not owned), the same team/status/
 * project + parent + depth-cap invariants as create are enforced, then the patch
 * is written back with a Tier-2 statement that folds in the recursive-CTE reparent
 * cycle guard and the array-scoped tenant match, stamping the four `actor_*`
 * columns inline. Throws `DomainError('not_found')` when not owned (or a concurrent
 * delete), `DomainError('cycle')` when the reachability guard blocks a parent-set.
 */
export async function updateWorkItem(
  sql: Sql,
  ctx: { tenantIds: string[]; actor: ActorSource; expectedVersion?: number },
  id: string,
  patch: UpdateWorkItemInput,
): Promise<WorkItemRow> {
  const { tenantIds } = ctx
  // `expectedVersion` is a forward-seam for optimistic concurrency (design §14's
  // fencing token). v1 `work_items` has NO version column, so the check is a
  // deliberate no-op here — the proposal-apply claim-flip is the sole concurrency
  // gate in v1. It is threaded through so the apply path and its callers already
  // pass it; when the column lands, condition the UPDATE on it and throw
  // `DomainError('stale')` on a version mismatch. (No column is invented now.)
  void ctx.expectedVersion

  const existing = (await sql`
    select * from work_items where id = ${id} and tenant_id = any(${tenantIds})
  `) as WorkItemRow[]
  const current = existing[0]
  if (!current) throw new DomainError('not_found', 'Not found')

  if (patch.team_id != null) {
    const ownedTeam = (await sql`
      select 1 from teams where id = ${patch.team_id} and tenant_id = any(${tenantIds})
    `) as unknown[]
    if (ownedTeam.length === 0) throw new DomainError('unknown_team', 'Unknown team')
    // A Task and its parent must share a team, so an item in a hierarchy cannot
    // change team on its own — either side would strand the other. Reject a team
    // move while the item is a child (has a parent) OR a parent (has children).
    if (patch.team_id !== current.team_id) {
      if (current.parent_id != null) {
        throw new DomainError(
          'cannot_change_team_in_hierarchy',
          'cannot change a sub-item’s team; re-parent or unparent it first',
        )
      }
      const kids = (await sql`
        select 1 from work_items where parent_id = ${id} limit 1
      `) as unknown[]
      if (kids.length > 0) {
        throw new DomainError(
          'cannot_change_team_in_hierarchy',
          'cannot change the team of an item with sub-items; move or detach them first',
        )
      }
    }
  }

  // A reassigned status must belong to the item's (possibly newly-set) team.
  if (patch.status_id != null) {
    const effectiveTeamId = patch.team_id ?? current.team_id
    const ownedStatus = (await sql`
      select 1 from statuses where id = ${patch.status_id} and team_id = ${effectiveTeamId}
    `) as unknown[]
    if (ownedStatus.length === 0) throw new DomainError('unknown_status', 'Unknown status')
  }

  if (patch.project_id != null) {
    const owned = (await sql`
      select 1 from projects where id = ${patch.project_id} and tenant_id = any(${tenantIds})
    `) as unknown[]
    if (owned.length === 0) throw new DomainError('unknown_project', 'Unknown project')
  }

  // parent_id patch: SETTING establishes the Task tier; CLEARING (explicit null)
  // promotes back to top-level. Absent ⇒ unchanged. Same guards as create; self-
  // parent rejected here; a descendant-as-parent is caught by the depth cap AND,
  // as a race backstop, by the recursive-ancestors guard folded into the UPDATE.
  let nextParentId: string | null = current.parent_id
  let nextDepth = current.depth
  const settingParent = 'parent_id' in patch && patch.parent_id != null
  if ('parent_id' in patch) {
    if (patch.parent_id == null) {
      nextParentId = null
      nextDepth = 0
    } else {
      if (patch.parent_id === id) {
        throw new DomainError('self_parent', 'A work item cannot be its own parent')
      }
      const childRows = (await sql`
        select 1 from work_items where parent_id = ${id} limit 1
      `) as unknown[]
      if (childRows.length > 0) {
        throw new DomainError('parent_has_children', 'cannot nest an item that has its own sub-items')
      }
      const effectiveTeamId = patch.team_id ?? current.team_id
      const parentRows = (await sql`
        select team_id, parent_id from work_items
        where id = ${patch.parent_id} and tenant_id = any(${tenantIds})
      `) as { team_id: string; parent_id: string | null }[]
      const parent = parentRows[0]
      if (!parent) throw new DomainError('unknown_parent', 'Unknown parent')
      if (parent.team_id !== effectiveTeamId)
        throw new DomainError('parent_different_team', 'parent belongs to a different team')
      if (parent.parent_id != null) throw new DomainError('max_depth', 'max nesting depth is 1')
      nextParentId = patch.parent_id
      nextDepth = 1
    }
  }

  const next = { ...current, ...patch }
  // Tier-2 escape hatch: this update carries the recursive-CTE cycle guard and an
  // array-scoped tenant match, so it keeps its own SQL and stamps all four actor_*
  // columns inline — on the OUTER update's SET, never inside the ancestors CTE. The
  // WHERE NOT EXISTS reachability guard closes the check-then-write gap where a
  // concurrent request commits a reaching path; a no-op when no parent is set.
  const resolvedActor = await resolveActor(ctx.actor)
  const actor = actorAssignments(resolvedActor)

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
    // The row exists (fetched above) — a no-match now means the reachability guard
    // blocked a parent-set that would close a cycle. Otherwise a genuine not-found
    // (e.g. a concurrent delete).
    if (settingParent) throw new DomainError('cycle', 'parent_id would create a cycle')
    throw new DomainError('not_found', 'Not found')
  }

  // The activity event is a separate (non-atomic) write — it runs only when the
  // update matched, so it can't share the conditional update's batch. Ordered
  // update-first/event-second: the only failure mode is a missing event, never a
  // phantom one. It is stamped with the SAME real actor as the UPDATE above — an
  // agent-applied update records an `agent` event (run + on_behalf_of), never a
  // spoofed `human`.
  await recordWrite(
    sql,
    {
      table: 'activity_events',
      operation: 'insert',
      values: { work_item_id: id, kind: 'updated', summary: summarizeUpdate(patch) },
    },
    resolvedActor,
  )
  return updated
}
