import type { Project, Task, WorkItem } from "./types";

/**
 * In-memory mock dataset for the Workboard data seam.
 *
 * Realistic shape per the task: ~8-12 work items across 2-3 departments, mixed
 * phases, with tasks (mixed status) so derived health VARIES across all three
 * values; 1-2 projects plus some null `project_id` (loose work items — §1
 * containment-optional rule).
 *
 * Timestamps are fixed ISO strings (not `Date.now()`), so fixtures are stable;
 * `due_date`s straddle a reference "now" of 2026-06-20 so that
 * {@link deriveHealth} produces a deliberate spread of on_track / at_risk /
 * blocked when evaluated around that date.
 *
 * `WORK_ITEMS`, `TASKS`, and `PROJECTS` are exported deep-clone factories so the
 * mock repository can mutate freely without poisoning the source fixtures
 * (important for test isolation).
 */

const T = (iso: string): string => iso;

const RAW_PROJECTS: ReadonlyArray<Project> = [
  {
    id: "proj_v2",
    name: "v2.0 release",
    kind: "software",
    created_at: T("2026-04-01T09:00:00.000Z"),
    updated_at: T("2026-06-15T09:00:00.000Z"),
  },
  {
    id: "proj_diwali",
    name: "Diwali campaign",
    kind: "marketing",
    created_at: T("2026-05-10T09:00:00.000Z"),
    updated_at: T("2026-06-18T09:00:00.000Z"),
  },
];

const RAW_WORK_ITEMS: ReadonlyArray<WorkItem> = [
  // --- Engineering (proj_v2) ---
  {
    id: "wi_auth",
    title: "Workspace auth hardening",
    phase: "execute",
    project_id: "proj_v2",
    department: "Engineering",
    assignee_id: "user_amara",
    due_date: T("2026-07-10T00:00:00.000Z"), // future → not overdue
    created_at: T("2026-05-01T09:00:00.000Z"),
    updated_at: T("2026-06-19T09:00:00.000Z"),
  },
  {
    id: "wi_realtime",
    title: "Realtime transport seam",
    phase: "plan",
    project_id: "proj_v2",
    department: "Engineering",
    assignee_id: "user_dev",
    due_date: T("2026-06-12T00:00:00.000Z"), // past + open task → blocked
    created_at: T("2026-04-20T09:00:00.000Z"),
    updated_at: T("2026-06-16T09:00:00.000Z"),
  },
  {
    id: "wi_migration",
    title: "Neon migration runner",
    phase: "review",
    project_id: "proj_v2",
    department: "Engineering",
    assignee_id: "user_amara",
    due_date: T("2026-06-30T00:00:00.000Z"), // future, but has an overdue task → at_risk
    created_at: T("2026-05-05T09:00:00.000Z"),
    updated_at: T("2026-06-19T09:00:00.000Z"),
  },
  {
    id: "wi_tabletoken",
    title: "Design token audit",
    phase: "done",
    project_id: "proj_v2",
    department: "Engineering",
    assignee_id: "user_dev",
    due_date: T("2026-06-01T00:00:00.000Z"), // past, but phase done + all tasks complete → on_track
    created_at: T("2026-04-15T09:00:00.000Z"),
    updated_at: T("2026-06-02T09:00:00.000Z"),
  },
  // --- Marketing (proj_diwali) ---
  {
    id: "wi_creatives",
    title: "Diwali creative set",
    phase: "execute",
    project_id: "proj_diwali",
    department: "Marketing",
    assignee_id: "user_priya",
    due_date: T("2026-06-15T00:00:00.000Z"), // past + open task → blocked
    created_at: T("2026-05-12T09:00:00.000Z"),
    updated_at: T("2026-06-18T09:00:00.000Z"),
  },
  {
    id: "wi_landing",
    title: "Campaign landing page",
    phase: "plan",
    project_id: "proj_diwali",
    department: "Marketing",
    assignee_id: null, // routed to department queue (§1)
    due_date: T("2026-08-01T00:00:00.000Z"), // future, open tasks not overdue → on_track
    created_at: T("2026-06-01T09:00:00.000Z"),
    updated_at: T("2026-06-17T09:00:00.000Z"),
  },
  {
    id: "wi_adspend",
    title: "Ad spend forecast",
    phase: "review",
    project_id: "proj_diwali",
    department: "Marketing",
    assignee_id: "user_priya",
    due_date: T("2026-06-10T00:00:00.000Z"), // past + no tasks → at_risk
    created_at: T("2026-05-20T09:00:00.000Z"),
    updated_at: T("2026-06-16T09:00:00.000Z"),
  },
  // --- Sourcing (no project — loose work items, §1 containment optional) ---
  {
    id: "wi_supplier",
    title: "Q3 supplier shortlist",
    phase: "execute",
    project_id: null,
    department: "Sourcing",
    assignee_id: "user_kenji",
    due_date: T("2026-07-20T00:00:00.000Z"), // future, has overdue task → at_risk
    created_at: T("2026-05-25T09:00:00.000Z"),
    updated_at: T("2026-06-19T09:00:00.000Z"),
  },
  {
    id: "wi_samples",
    title: "Sample QC checklist",
    phase: "done",
    project_id: null,
    department: "Sourcing",
    assignee_id: "user_kenji",
    due_date: null, // no due date, all tasks complete → on_track
    created_at: T("2026-04-30T09:00:00.000Z"),
    updated_at: T("2026-06-05T09:00:00.000Z"),
  },
  {
    id: "wi_logistics",
    title: "Warehouse intake flow",
    phase: "plan",
    project_id: null,
    department: "Sourcing",
    assignee_id: null,
    due_date: T("2026-06-05T00:00:00.000Z"), // past + open task → blocked
    created_at: T("2026-05-15T09:00:00.000Z"),
    updated_at: T("2026-06-14T09:00:00.000Z"),
  },
];

const RAW_TASKS: ReadonlyArray<Task> = [
  // wi_auth — execute, future due, mixed open tasks (none overdue) → on_track
  taskOf("t_auth_1", "wi_auth", "Token verifier interface", "completed", null),
  taskOf("t_auth_2", "wi_auth", "Session bridge wiring", "in_progress", "2026-07-05T00:00:00.000Z"),

  // wi_realtime — plan, item overdue + open tasks → blocked
  taskOf("t_rt_1", "wi_realtime", "Spike Durable Objects", "in_progress", "2026-06-20T00:00:00.000Z"),
  taskOf("t_rt_2", "wi_realtime", "Define RealtimeTransport", "todo", null),

  // wi_migration — review, item future due, but one task overdue+open → at_risk
  taskOf("t_mig_1", "wi_migration", "Port pg_cron job", "completed", null),
  taskOf("t_mig_2", "wi_migration", "Codegen step", "in_progress", "2026-06-12T00:00:00.000Z"),

  // wi_tabletoken — done, item overdue but all tasks complete → on_track
  taskOf("t_tok_1", "wi_tabletoken", "Replace hex colors", "completed", null),
  taskOf("t_tok_2", "wi_tabletoken", "Add missing tokens", "completed", null),

  // wi_creatives — execute, item overdue + open task → blocked
  taskOf("t_cr_1", "wi_creatives", "Hero banner", "completed", null),
  taskOf("t_cr_2", "wi_creatives", "Story templates", "todo", null),

  // wi_landing — plan, item future, open tasks not overdue → on_track
  taskOf("t_ld_1", "wi_landing", "Wireframe", "in_progress", "2026-07-25T00:00:00.000Z"),

  // wi_adspend — review, item overdue + NO tasks → at_risk (no tasks added)

  // wi_supplier — execute, item future, but one task overdue+open → at_risk
  taskOf("t_sup_1", "wi_supplier", "Collect quotes", "completed", null),
  taskOf("t_sup_2", "wi_supplier", "Audit lead times", "todo", "2026-06-18T00:00:00.000Z"),

  // wi_samples — done, no due date, all complete → on_track
  taskOf("t_sam_1", "wi_samples", "Define QC criteria", "completed", null),

  // wi_logistics — plan, item overdue + open task → blocked
  taskOf("t_log_1", "wi_logistics", "Map intake stations", "in_progress", null),
];

function taskOf(
  id: string,
  workItemId: string,
  title: string,
  status: Task["status"],
  dueDate: string | null,
): Task {
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

/** Deep-clone factory: fresh `Project[]` per call (mutation-safe for the mock). */
export function createProjectFixtures(): Project[] {
  return RAW_PROJECTS.map((project) => ({ ...project }));
}

/** Deep-clone factory: fresh `WorkItem[]` per call (mutation-safe for the mock). */
export function createWorkItemFixtures(): WorkItem[] {
  return RAW_WORK_ITEMS.map((item) => ({ ...item }));
}

/** Deep-clone factory: fresh `Task[]` per call (mutation-safe for the mock). */
export function createTaskFixtures(): Task[] {
  return RAW_TASKS.map((task) => ({ ...task }));
}
