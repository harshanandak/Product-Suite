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
 * blocked when evaluated around that date. The per-item health outcome is noted
 * inline; the authoritative assertions live in the deriveHealth tests.
 *
 * `WORK_ITEMS`, `TASKS`, and `PROJECTS` are exported deep-clone factories so the
 * mock repository can mutate freely without poisoning the source fixtures
 * (important for test isolation). Rows are built through the `workItemOf` /
 * `taskOf` factories so the repeated record shape lives in one place.
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
  // future due, no overdue tasks → on_track
  workItemOf("wi_auth", "Workspace auth hardening", "execute", "Engineering", "proj_v2", "user_amara", "2026-07-10T00:00:00.000Z", "2026-05-01T09:00:00.000Z", "2026-06-19T09:00:00.000Z"),
  // item overdue + open task → blocked
  workItemOf("wi_realtime", "Realtime transport seam", "plan", "Engineering", "proj_v2", "user_dev", "2026-06-12T00:00:00.000Z", "2026-04-20T09:00:00.000Z", "2026-06-16T09:00:00.000Z"),
  // future due, but one task overdue+open → at_risk
  workItemOf("wi_migration", "Neon migration runner", "review", "Engineering", "proj_v2", "user_amara", "2026-06-30T00:00:00.000Z", "2026-05-05T09:00:00.000Z", "2026-06-19T09:00:00.000Z"),
  // overdue, but phase done + all tasks complete → on_track
  workItemOf("wi_tabletoken", "Design token audit", "done", "Engineering", "proj_v2", "user_dev", "2026-06-01T00:00:00.000Z", "2026-04-15T09:00:00.000Z", "2026-06-02T09:00:00.000Z"),
  // --- Marketing (proj_diwali) ---
  // item overdue + open task → blocked
  workItemOf("wi_creatives", "Diwali creative set", "execute", "Marketing", "proj_diwali", "user_priya", "2026-06-15T00:00:00.000Z", "2026-05-12T09:00:00.000Z", "2026-06-18T09:00:00.000Z"),
  // null assignee (department queue, §1); future, open tasks not overdue → on_track
  workItemOf("wi_landing", "Campaign landing page", "plan", "Marketing", "proj_diwali", null, "2026-08-01T00:00:00.000Z", "2026-06-01T09:00:00.000Z", "2026-06-17T09:00:00.000Z"),
  // item overdue + no tasks → at_risk
  workItemOf("wi_adspend", "Ad spend forecast", "review", "Marketing", "proj_diwali", "user_priya", "2026-06-10T00:00:00.000Z", "2026-05-20T09:00:00.000Z", "2026-06-16T09:00:00.000Z"),
  // --- Sourcing (no project — loose work items, §1 containment optional) ---
  // future, but one task overdue+open → at_risk
  workItemOf("wi_supplier", "Q3 supplier shortlist", "execute", "Sourcing", null, "user_kenji", "2026-07-20T00:00:00.000Z", "2026-05-25T09:00:00.000Z", "2026-06-19T09:00:00.000Z"),
  // no due date, all tasks complete → on_track
  workItemOf("wi_samples", "Sample QC checklist", "done", "Sourcing", null, "user_kenji", null, "2026-04-30T09:00:00.000Z", "2026-06-05T09:00:00.000Z"),
  // item overdue + open task → blocked
  workItemOf("wi_logistics", "Warehouse intake flow", "plan", "Sourcing", null, null, "2026-06-05T00:00:00.000Z", "2026-05-15T09:00:00.000Z", "2026-06-14T09:00:00.000Z"),
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

/**
 * Build a {@link WorkItem} from its distinguishing fields. Centralizes the record
 * shape so the fixture list stays a flat, low-noise table of values.
 */
function workItemOf(
  id: string,
  title: string,
  phase: WorkItem["phase"],
  department: string,
  projectId: string | null,
  assigneeId: string | null,
  dueDate: string | null,
  createdAt: string,
  updatedAt: string,
): WorkItem {
  return {
    id,
    title,
    phase,
    project_id: projectId,
    department,
    assignee_id: assigneeId,
    due_date: dueDate === null ? null : T(dueDate),
    created_at: T(createdAt),
    updated_at: T(updatedAt),
  };
}

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
