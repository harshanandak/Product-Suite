import type {
  ActivityEvent,
  ActivityEventKind,
  DependencyRelationship,
  Owner,
  Project,
  Check,
  WorkItem,
  WorkItemDependency,
} from "./types";

/**
 * In-memory mock dataset for the Workboard data seam.
 *
 * Realistic shape per the task: ~8-12 work items across 2-3 departments, mixed
 * phases, with checks (mixed status) so derived health VARIES across all three
 * values; 1-2 projects plus some null `project_id` (loose work items — §1
 * containment-optional rule).
 *
 * Timestamps are fixed ISO strings (not `Date.now()`), so fixtures are stable;
 * `due_date`s straddle a reference "now" of 2026-06-20 so that
 * {@link deriveHealth} produces a deliberate spread of on_track / at_risk /
 * blocked when evaluated around that date. The per-item health outcome is noted
 * inline; the authoritative assertions live in the deriveHealth tests.
 *
 * `WORK_ITEMS`, `CHECKS`, and `PROJECTS` are exported deep-clone factories so the
 * mock repository can mutate freely without poisoning the source fixtures
 * (important for test isolation). Rows are built through the `workItemOf` /
 * `checkOf` factories so the repeated record shape lives in one place.
 */

const T = (iso: string): string => iso;

/**
 * People who can own work items. Each `id` matches an `assignee_id` used in
 * {@link RAW_WORK_ITEMS} so the owner lookup resolves; items with
 * `assignee_id: null` route to a department queue (no owner) — they
 * deliberately have NO entry here.
 */
const RAW_OWNERS: ReadonlyArray<Owner> = [
  { id: "user_amara", name: "Amara Okafor", initials: "AO" },
  { id: "user_dev", name: "Dev Patel", initials: "DP" },
  { id: "user_priya", name: "Priya Sharma", initials: "PS" },
  { id: "user_kenji", name: "Kenji Tanaka", initials: "KT" },
];

const RAW_PROJECTS: ReadonlyArray<Project> = [
  {
    id: "proj_v2",
    name: "v2.0 release",
    kind: "software",
    status: "in_progress",
    lead_id: "user_kenji",
    target_date: T("2026-08-01T09:00:00.000Z"),
    created_at: T("2026-04-01T09:00:00.000Z"),
    updated_at: T("2026-06-15T09:00:00.000Z"),
  },
  {
    id: "proj_diwali",
    name: "Diwali campaign",
    kind: "marketing",
    status: "planned",
    lead_id: null,
    target_date: null,
    created_at: T("2026-05-10T09:00:00.000Z"),
    updated_at: T("2026-06-18T09:00:00.000Z"),
  },
];

const RAW_WORK_ITEMS: ReadonlyArray<WorkItem> = [
  // --- Engineering (proj_v2) ---
  // future due, no overdue checks → on_track
  workItemOf("wi_auth", "Workspace auth hardening", "execute", "Engineering", { description: "Harden workspace auth before v2.0: add a token-verifier interface, wire the session bridge, and close the gaps the Q2 security review surfaced.", type: "feature", priority: "high", tags: ["security", "backend"], source: "manual", projectId: "proj_v2", assigneeId: "user_amara", dueDate: "2026-07-10T00:00:00.000Z", createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-06-19T09:00:00.000Z" }),
  // item overdue + open check → blocked
  workItemOf("wi_realtime", "Realtime transport seam", "plan", "Engineering", { description: "Define the RealtimeTransport seam so the workboard can subscribe to server-side invalidations. Spike Durable Objects first; the interface lands before F2.", type: "feature", priority: "critical", tags: ["infra", "realtime"], source: "agent", projectId: "proj_v2", assigneeId: "user_dev", dueDate: "2026-06-12T00:00:00.000Z", createdAt: "2026-04-20T09:00:00.000Z", updatedAt: "2026-06-16T09:00:00.000Z" }),
  // future due, but one check overdue+open → at_risk
  workItemOf("wi_migration", "Neon migration runner", "review", "Engineering", { type: "chore", priority: "high", tags: ["infra", "database"], source: "manual", projectId: "proj_v2", assigneeId: "user_amara", dueDate: "2026-06-30T00:00:00.000Z", createdAt: "2026-05-05T09:00:00.000Z", updatedAt: "2026-06-19T09:00:00.000Z" }),
  // overdue, but phase done + all checks complete → on_track
  workItemOf("wi_tabletoken", "Design token audit", "done", "Engineering", { type: "chore", priority: "low", tags: ["design-system"], source: "feedback", projectId: "proj_v2", assigneeId: "user_dev", dueDate: "2026-06-01T00:00:00.000Z", createdAt: "2026-04-15T09:00:00.000Z", updatedAt: "2026-06-02T09:00:00.000Z" }),
  // --- Marketing (proj_diwali) ---
  // item overdue + open check → blocked
  workItemOf("wi_creatives", "Diwali creative set", "execute", "Marketing", { description: "Produce the Diwali campaign creative set — hero banner, story templates, and channel cutdowns — ready for the landing page and paid social.", type: "feature", priority: "high", tags: ["campaign", "design"], source: "manual", projectId: "proj_diwali", assigneeId: "user_priya", dueDate: "2026-06-15T00:00:00.000Z", createdAt: "2026-05-12T09:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z" }),
  // null assignee (department queue, §1); future, open checks not overdue → on_track
  workItemOf("wi_landing", "Campaign landing page", "plan", "Marketing", { type: "feature", priority: "medium", tags: ["campaign", "web"], source: "meeting", projectId: "proj_diwali", assigneeId: null, dueDate: "2026-08-01T00:00:00.000Z", createdAt: "2026-06-01T09:00:00.000Z", updatedAt: "2026-06-17T09:00:00.000Z" }),
  // item overdue + no checks → at_risk
  workItemOf("wi_adspend", "Ad spend forecast", "review", "Marketing", { type: "research", priority: "medium", tags: ["budget"], source: "agent", projectId: "proj_diwali", assigneeId: "user_priya", dueDate: "2026-06-10T00:00:00.000Z", createdAt: "2026-05-20T09:00:00.000Z", updatedAt: "2026-06-16T09:00:00.000Z" }),
  // --- Sourcing (no project — loose work items, §1 containment optional) ---
  // future, but one check overdue+open → at_risk
  workItemOf("wi_supplier", "Q3 supplier shortlist", "execute", "Sourcing", { description: "Shortlist Q3 suppliers: collect quotes, audit lead times against the warehouse intake plan, and recommend two primaries plus a backup.", type: "research", priority: "high", tags: ["sourcing", "q3"], source: "meeting", projectId: null, assigneeId: "user_kenji", dueDate: "2026-07-20T00:00:00.000Z", createdAt: "2026-05-25T09:00:00.000Z", updatedAt: "2026-06-19T09:00:00.000Z" }),
  // no due date, all checks complete → on_track
  workItemOf("wi_samples", "Sample QC checklist", "done", "Sourcing", { type: "chore", priority: "low", tags: ["quality"], source: "manual", projectId: null, assigneeId: "user_kenji", dueDate: null, archived: true, createdAt: "2026-04-30T09:00:00.000Z", updatedAt: "2026-06-05T09:00:00.000Z" }),
  // item overdue + open check → blocked
  workItemOf("wi_logistics", "Warehouse intake flow", "plan", "Sourcing", { type: "bug", priority: "critical", tags: ["ops", "logistics"], source: "feedback", projectId: null, assigneeId: null, dueDate: "2026-06-05T00:00:00.000Z", createdAt: "2026-05-15T09:00:00.000Z", updatedAt: "2026-06-14T09:00:00.000Z" }),
];

const RAW_CHECKS: ReadonlyArray<Check> = [
  // wi_auth — execute, future due, mixed open checks (none overdue) → on_track
  checkOf("t_auth_1", "wi_auth", "Token verifier interface", "completed", null),
  checkOf("t_auth_2", "wi_auth", "Session bridge wiring", "in_progress", "2026-07-05T00:00:00.000Z"),

  // wi_realtime — plan, item overdue + open checks → blocked
  checkOf("t_rt_1", "wi_realtime", "Spike Durable Objects", "in_progress", "2026-06-20T00:00:00.000Z"),
  checkOf("t_rt_2", "wi_realtime", "Define RealtimeTransport", "todo", null),

  // wi_migration — review, item future due, but one check overdue+open → at_risk
  checkOf("t_mig_1", "wi_migration", "Port pg_cron job", "completed", null),
  checkOf("t_mig_2", "wi_migration", "Codegen step", "in_progress", "2026-06-12T00:00:00.000Z"),

  // wi_tabletoken — done, item overdue but all checks complete → on_track
  checkOf("t_tok_1", "wi_tabletoken", "Replace hex colors", "completed", null),
  checkOf("t_tok_2", "wi_tabletoken", "Add missing tokens", "completed", null),

  // wi_creatives — execute, item overdue + open check → blocked
  checkOf("t_cr_1", "wi_creatives", "Hero banner", "completed", null),
  checkOf("t_cr_2", "wi_creatives", "Story templates", "todo", null),

  // wi_landing — plan, item future, open checks not overdue → on_track
  checkOf("t_ld_1", "wi_landing", "Wireframe", "in_progress", "2026-07-25T00:00:00.000Z"),

  // wi_adspend — review, item overdue + NO checks → at_risk (no checks added)

  // wi_supplier — execute, item future, but one check overdue+open → at_risk
  checkOf("t_sup_1", "wi_supplier", "Collect quotes", "completed", null),
  checkOf("t_sup_2", "wi_supplier", "Audit lead times", "todo", "2026-06-18T00:00:00.000Z"),

  // wi_samples — done, no due date, all complete → on_track
  checkOf("t_sam_1", "wi_samples", "Define QC criteria", "completed", null),

  // wi_logistics — plan, item overdue + open check → blocked
  checkOf("t_log_1", "wi_logistics", "Map intake stations", "in_progress", null),
];

/**
 * Dependency edges across the seeded items (DESIGN §10 graph edges). Each is a
 * directed `source → target` ("source depends on target"). Deliberately a valid
 * DAG — no cycles, no self-edges, no duplicate pairs — so dagre lays it out and
 * the cycle/self/duplicate guards have a clean baseline. Shapes:
 *  - proj_v2: wi_auth → wi_migration → wi_realtime, plus wi_auth → wi_realtime
 *    (a small diamond / multi-level chain); wi_tabletoken is an orphan (no edges).
 *  - proj_diwali: wi_landing → wi_creatives; wi_adspend is an orphan.
 *  - sourcing (no project): wi_logistics → wi_supplier → wi_samples.
 */
const RAW_DEPENDENCIES: ReadonlyArray<WorkItemDependency> = [
  dependencyOf("dep_auth_realtime", "wi_auth", "wi_realtime"),
  dependencyOf("dep_auth_migration", "wi_auth", "wi_migration"),
  dependencyOf("dep_migration_realtime", "wi_migration", "wi_realtime"),
  dependencyOf("dep_landing_creatives", "wi_landing", "wi_creatives"),
  dependencyOf("dep_logistics_supplier", "wi_logistics", "wi_supplier"),
  dependencyOf("dep_supplier_samples", "wi_supplier", "wi_samples"),
];

/**
 * Seed activity — an append-only per-item change log the mock returns for the
 * detail page's Activity tab (and which every mutation appends to at runtime).
 * Stored chronological; newest-first ordering is applied on read.
 */
const RAW_ACTIVITY: ReadonlyArray<ActivityEvent> = [
  activityOf("act_auth_1", "wi_auth", "created", "Created “Workspace auth hardening”", "2026-05-01T09:00:00.000Z"),
  activityOf("act_auth_2", "wi_auth", "dependency_added", "Added a dependency on “Realtime transport seam”", "2026-05-04T10:15:00.000Z"),
  activityOf("act_auth_3", "wi_auth", "updated", "Owner set to Amara Okafor", "2026-05-08T13:20:00.000Z"),
  activityOf("act_auth_4", "wi_auth", "updated", "Phase set to Execute", "2026-05-20T09:05:00.000Z"),
  activityOf("act_auth_5", "wi_auth", "updated", "Due date set to Jul 10", "2026-06-19T09:00:00.000Z"),
  activityOf("act_cr_1", "wi_creatives", "created", "Created “Diwali creative set”", "2026-05-12T09:00:00.000Z"),
  activityOf("act_cr_2", "wi_creatives", "updated", "Phase set to Execute", "2026-05-30T16:40:00.000Z"),
];

/**
 * Build a {@link WorkItemDependency}. `relationship_type` defaults to
 * `depends_on` (the only kind v1 renders); `created_at` is a fixed ISO string so
 * fixtures stay stable.
 */
function dependencyOf(
  id: string,
  sourceItemId: string,
  targetItemId: string,
  relationshipType: DependencyRelationship = "depends_on",
): WorkItemDependency {
  return {
    id,
    source_item_id: sourceItemId,
    target_item_id: targetItemId,
    relationship_type: relationshipType,
    created_at: T("2026-06-01T09:00:00.000Z"),
  };
}

/**
 * Optional/contextual fields for {@link workItemOf}. Grouped into one object so
 * the factory stays at 5 params (S107-clean) while every fixture value is still
 * expressible. Defaults cover the loose-item cases (no project, no assignee, no
 * due date) and a neutral descriptive baseline (`chore` / `medium` / no tags /
 * `manual` provenance) that individual fixtures override.
 */
interface WorkItemOptions {
  description?: string;
  type?: WorkItem["type"];
  priority?: WorkItem["priority"];
  tags?: string[];
  source?: WorkItem["source"];
  projectId?: string | null;
  /** Owning team id; defaults to a stable id derived from the `department` name. */
  teamId?: string;
  /** Owning workflow status id; defaults to a stable id derived from the `phase`. */
  statusId?: string;
  /** Optional parent work item id; `null` (default) = a top-level item. */
  parentId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Build a {@link WorkItem} from its distinguishing fields. Centralizes the record
 * shape so the fixture list stays a flat, low-noise table of values.
 */
function workItemOf(
  id: string,
  title: string,
  phase: WorkItem["phase"],
  department: string,
  options: WorkItemOptions = {},
): WorkItem {
  const {
    description = "",
    type = "chore",
    priority = "medium",
    tags = [],
    source = "manual",
    projectId = null,
    // Every work item has a mandatory team; the fixtures promote each `department`
    // to a stable per-department team id (`Engineering` → `team_engineering`) so
    // the mock dataset satisfies the required `team_id` without a separate table.
    teamId = `team_${department.toLowerCase()}`,
    // Every work item has a mandatory workflow status. The mock maps each `phase`
    // to a stable per-team status id (`Engineering` + `execute` →
    // `status_engineering_execute`) so the dataset satisfies the required
    // `status_id` without a separate statuses table.
    statusId = `status_${department.toLowerCase()}_${phase}`,
    // Fixtures are all top-level today (no nested Tasks), so `parent_id` defaults
    // to null and `depth` derives to 0. `depth` is server-derived (1 under a
    // parent) — mirror that here rather than storing it independently.
    parentId = null,
    assigneeId = null,
    dueDate = null,
    archived = false,
    createdAt = "2026-05-01T09:00:00.000Z",
    updatedAt = "2026-06-19T09:00:00.000Z",
  } = options;
  return {
    id,
    title,
    description,
    phase,
    type,
    priority,
    tags: [...tags],
    source,
    project_id: projectId,
    team_id: teamId,
    status_id: statusId,
    parent_id: parentId,
    depth: parentId === null ? 0 : 1,
    department,
    assignee_id: assigneeId,
    due_date: dueDate === null ? null : T(dueDate),
    archived,
    created_at: T(createdAt),
    updated_at: T(updatedAt),
  };
}

function checkOf(
  id: string,
  workItemId: string,
  title: string,
  status: Check["status"],
  dueDate: string | null,
): Check {
  return {
    id,
    work_item_id: workItemId,
    title,
    status,
    due_date: dueDate,
    created_at: T("2026-05-01T09:00:00.000Z"),
    updated_at: T("2026-06-19T09:00:00.000Z"),
  };
}

/** Build an {@link ActivityEvent} with a fixed timestamp so fixtures stay stable. */
function activityOf(
  id: string,
  workItemId: string,
  kind: ActivityEventKind,
  summary: string,
  createdAt: string,
): ActivityEvent {
  return {
    id,
    work_item_id: workItemId,
    kind,
    summary,
    created_at: T(createdAt),
  };
}

/** Deep-clone factory: fresh `Owner[]` per call (mutation-safe for the mock). */
export function createOwnerFixtures(): Owner[] {
  return RAW_OWNERS.map((owner) => ({ ...owner }));
}

/** Deep-clone factory: fresh `Project[]` per call (mutation-safe for the mock). */
export function createProjectFixtures(): Project[] {
  return RAW_PROJECTS.map((project) => ({ ...project }));
}

/**
 * Deep-clone factory: fresh `WorkItem[]` per call (mutation-safe for the mock).
 * `tags` is copied too — a shallow spread would alias the source array, letting
 * a caller's `tags.push(...)` / `.sort()` poison RAW and every other instance.
 */
export function createWorkItemFixtures(): WorkItem[] {
  return RAW_WORK_ITEMS.map((item) => ({ ...item, tags: [...item.tags] }));
}

/** Deep-clone factory: fresh `Check[]` per call (mutation-safe for the mock). */
export function createCheckFixtures(): Check[] {
  return RAW_CHECKS.map((check) => ({ ...check }));
}

/**
 * Deep-clone factory: fresh `WorkItemDependency[]` per call (mutation-safe for
 * the mock — `addDependency`/`removeDependency` mutate this array in place).
 */
export function createDependencyFixtures(): WorkItemDependency[] {
  return RAW_DEPENDENCIES.map((dependency) => ({ ...dependency }));
}

/** Deep-clone factory: fresh `ActivityEvent[]` per call (mutation-safe for the mock). */
export function createActivityFixtures(): ActivityEvent[] {
  return RAW_ACTIVITY.map((event) => ({ ...event }));
}
