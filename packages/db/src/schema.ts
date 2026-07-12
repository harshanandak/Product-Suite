import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Drizzle schema for the platform's WORKBOARD tables on the shared Neon DB.
 *
 * IMPORTANT — this DB already hosts the meeting module and a full tenancy model
 * (Alembic-managed): `tenants`, `organization_memberships`, `users`,
 * `user_auth_identities`. We do NOT recreate those. Drizzle manages only the new
 * workboard tables below; they reference the existing tenancy by id:
 *   - `work_items.tenant_id`  → tenants.id   (text)  — the org IS the workspace
 *   - `projects.tenant_id`    → tenants.id   (text)
 *   - `work_items.assignee_id`→ users.id     (text, nullable)
 * Those cross-tool FK constraints are added in the migration (the referenced
 * tables are Alembic-owned, so they aren't Drizzle table objects here).
 *
 * Model note: workspace = organization = tenant — ONE level (a Clerk Organization
 * maps to a `tenants` row, the org boundary). Work items belong to a mandatory
 * `team` WITHIN the org (the owner/partition, promoted from the old free-text
 * `department`, which is retained deprecated) plus an optional `project`. There is
 * deliberately no separate workspace layer.
 *
 * Auth: the Clerk identity (`claims.subject`) resolves to an internal user via
 * `user_auth_identities(provider='clerk', provider_user_id=subject)`, and to a
 * tenant + role via `organization_memberships`. The API scopes every query to
 * the caller's tenant; ids are never trusted from the client.
 *
 * Enums mirror `@product-suite/contracts` exactly.
 */

// --- Enums (mirror @product-suite/contracts) ---
export const phaseEnum = pgEnum('phase', ['plan', 'execute', 'review', 'done'])
export const workItemTypeEnum = pgEnum('work_item_type', ['feature', 'bug', 'chore', 'research'])
export const priorityEnum = pgEnum('priority', ['critical', 'high', 'medium', 'low'])
export const checkStatusEnum = pgEnum('check_status', ['todo', 'in_progress', 'completed'])
export const workItemSourceEnum = pgEnum('work_item_source', ['manual', 'meeting', 'agent', 'feedback'])
export const dependencyRelationshipEnum = pgEnum('dependency_relationship', ['depends_on', 'blocks', 'complements'])
export const activityEventKindEnum = pgEnum('activity_event_kind', ['created', 'updated', 'dependency_added', 'dependency_removed'])
// Immutable status CATEGORIES (global, never mode-editable). A team's named
// statuses each map to exactly one category; every rollup/automation reads the
// category, never the name. Replaces the old `phase` enum. `triage` is reserved
// for the integration/agent inbox.
export const statusCategoryEnum = pgEnum('status_category', [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'triage',
])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

// Project lifecycle status (the cross-team OUTCOME container's own state, distinct
// from a work item's team-scoped workflow status). Mirrors Linear's project states.
export const projectStatusEnum = pgEnum('project_status', [
  'backlog',
  'planned',
  'in_progress',
  'paused',
  'completed',
  'canceled',
])

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The org (= workspace = tenant). References the Alembic-owned tenants(id);
    // FK added in the migration.
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    // Freeform category to satisfy the contracts `Project.kind`. Default keeps
    // existing rows valid; the product can specialize it later.
    kind: text('kind').notNull().default('general'),
    // Outcome-container enrichment: its own lifecycle status, an optional lead
    // (references the Alembic-owned users(id); FK added in the migration), and an
    // optional target date. Health stays DERIVED (never stored).
    status: projectStatusEnum('status').notNull().default('backlog'),
    leadId: text('lead_id'),
    targetDate: timestamp('target_date', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({ byTenant: index('projects_tenant_idx').on(t.tenantId) }),
)

/**
 * Teams — the mandatory owner/partition WITHIN an org (promoted from the old
 * free-text `work_items.department`). A Team is what carries the mode and, later,
 * owns the workflow statuses, cycles and triage. Every work item belongs to
 * exactly one team; teams belong to exactly one tenant (org).
 */
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The org (= workspace = tenant). References the Alembic-owned tenants(id);
    // FK added in the migration.
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => ({
    byTenant: index('teams_tenant_idx').on(t.tenantId),
    // A team name is unique within its org (the backfill maps DISTINCT department
    // 1:1, so this also guards against re-introducing duplicates).
    nameUniq: unique('teams_tenant_name_uniq').on(t.tenantId, t.name),
  }),
)

/**
 * Statuses — a team's named workflow states. Each belongs to one immutable
 * `category`; teams customize the NAME and order (`position`), never the category.
 * A work item's lifecycle state is `status_id` (replacing the old `phase` enum,
 * which is retained deprecated). Cascades with its team.
 */
export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: statusCategoryEnum('category').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    byTeam: index('statuses_team_idx').on(t.teamId),
    nameUniq: unique('statuses_team_name_uniq').on(t.teamId, t.name),
  }),
)

export const workItems = pgTable(
  'work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The org (= workspace = tenant). References the Alembic-owned tenants(id);
    // FK added in the migration.
    tenantId: text('tenant_id').notNull(),
    // The owning Team (mandatory). Promoted from the old `department` string,
    // which is retained (deprecated) for one contract cycle for Forge/back-compat.
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    // The workflow state (mandatory), one of the owning team's `statuses`.
    // Replaces `phase` (retained deprecated). Its category drives all rollups.
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'restrict' }),
    // Optional parent — a Task is a work item with a parent (the owned child tier).
    // Self-FK added in the migration (ON DELETE RESTRICT: a parent with sub-items
    // can't be hard-deleted until they're detached, so `depth` never goes stale).
    // Native creation is depth-capped at 1 (a parent must itself be top-level, and
    // an item that already has children cannot itself be nested); the cap is a MODE
    // POLICY enforced in the API, not a schema constraint — imports may bypass it
    // and land deeper trees (see design §2.5).
    parentId: uuid('parent_id'),
    // Materialized tree depth (0 = top-level). Stored from day one so the depth
    // cap can be raised later without a data migration. Maintained by the API.
    depth: integer('depth').notNull().default(0),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    phase: phaseEnum('phase').notNull().default('plan'),
    type: workItemTypeEnum('type').notNull().default('feature'),
    priority: priorityEnum('priority').notNull().default('medium'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    source: workItemSourceEnum('source').notNull().default('manual'),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    department: text('department').notNull(),
    // References existing users(id); null = routed to a department queue.
    assigneeId: text('assignee_id'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    archived: boolean('archived').notNull().default(false),
    ...timestamps,
  },
  (t) => ({ byTenant: index('work_items_tenant_idx').on(t.tenantId) }),
)

// Checks — the frozen checklist rows under an Item (title / status / due date,
// no owner). Renamed from `tasks`: "Task" is now the owned CHILD tier (a work
// item with a parent), so the checkbox tier is a Check to keep the two distinct.
export const checks = pgTable(
  'checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: checkStatusEnum('status').notNull().default('todo'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({ byWorkItem: index('checks_work_item_idx').on(t.workItemId) }),
)

export const workItemDependencies = pgTable(
  'work_item_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The org (= workspace = tenant). References the Alembic-owned tenants(id);
    // FK added in the migration.
    tenantId: text('tenant_id').notNull(),
    sourceItemId: uuid('source_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    targetItemId: uuid('target_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    relationshipType: dependencyRelationshipEnum('relationship_type').notNull().default('depends_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    edgeUniq: unique('work_item_dependencies_edge_uniq').on(t.sourceItemId, t.targetItemId),
    byTenant: index('work_item_dependencies_tenant_idx').on(t.tenantId),
  }),
)

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    kind: activityEventKindEnum('kind').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byWorkItem: index('activity_events_work_item_idx').on(t.workItemId) }),
)
