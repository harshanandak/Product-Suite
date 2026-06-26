import type {
  Health,
  Phase,
  Priority,
  TaskStatus,
  WorkItemSource,
  WorkItemType,
} from "@product-suite/ui";

/**
 * Workboard data-seam types (DESIGN §1, §2, §11).
 *
 * This is the FRONTEND model, built ahead of the F2 backend. Field names and
 * rules track DESIGN §11 exactly so only the repository adapter swaps when the
 * real transport lands. Hard rules encoded here:
 *
 * - `phase` lives on WORK ITEMS only (§1 / §3 / §11).
 * - `status` lives on TASKS only — work items have NO status column (§11).
 * - `health` is DERIVED client-side, never stored (see {@link deriveHealth}).
 * - `project_id` is nullable: a work item may have no project (§1 / §11).
 *
 * `Phase`, `TaskStatus`, `Health`, plus the richer `WorkItemType`, `Priority`,
 * and `WorkItemSource` enums are re-exported from `@product-suite/ui` (the
 * single source — DESIGN §5). Do NOT redefine them here.
 */
export type { Health, Phase, Priority, TaskStatus, WorkItemSource, WorkItemType };

// Timestamp fields below are ISO-8601 strings (e.g. `2026-06-20T09:30:00.000Z`).
// Plain `string` keeps the model JSON-friendly across the transport seam — no
// `Date` instances cross it.

/**
 * A project — top of the object ladder (§1). A "category of work as one
 * switchable thing" (v2.0 release, Diwali campaign, Q3 sourcing). The project
 * switcher is the Workboard's primary filter.
 *
 * Projects never carry a phase — a project's stage is derived from the
 * distribution of its items' phases (§1 phase-ownership rule).
 */
export interface Project {
  readonly id: string;
  name: string;
  /** Project kind drives playbook/department defaults (§1 / §11). */
  kind: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A person who can own a work item — the resolved display target for an item's
 * `assignee_id` (§1 owner concept). Structurally a subset of `@product-suite/ui`'s
 * `Assignee`, so an `Owner[]` feeds `AssigneePicker` directly. The store holds
 * only `assignee_id`; views resolve id → {@link Owner} via the `owners` lookup
 * the repository/hook expose (never embed the owner on the row).
 */
export interface Owner {
  /** Stable internal id — matches a work item's `assignee_id`. Never a provider id. */
  readonly id: string;
  /** Display name shown in pickers / the owner column. */
  name: string;
  /** Optional 1–2 char initials; the picker derives them from `name` when omitted. */
  initials?: string;
}

/**
 * A work item — the coalition hub (§1, middle of the object ladder).
 *
 * Carries `phase` (the only stored lifecycle on a work item) and a
 * workspace-defined `department` for swimlanes. `project_id` is nullable
 * (containment is optional at every level — §1 / §11). There is deliberately
 * NO `status` field and NO stored `health`.
 *
 * Richer descriptive fields back the deeper Table view (wireframe `plan-table`
 * columns): `type`, `priority`, `tags`, and `source` (provenance). These are
 * always present — `type`/`priority`/`source` are non-null enums and `tags`
 * defaults to `[]` — so a row never has to special-case a missing value.
 */
export interface WorkItem {
  readonly id: string;
  title: string;
  /** Universal phase loop `plan → execute → review → done` (§1). */
  phase: Phase;
  /** Kind of work — drives the Type column / filter (§11 playbook resolution). */
  type: WorkItemType;
  /** Severity used for the Priority column / sort (critical → low). */
  priority: Priority;
  /** Free-form labels shown in the Tags column; `[]` when none (never null). */
  tags: string[];
  /** Provenance — how the item entered the board (manual/meeting/agent/feedback). */
  source: WorkItemSource;
  /** Nullable — a work item may belong to no project (§1 / §11). */
  project_id: string | null;
  /**
   * Workspace-defined department NAME used for swimlanes / "Group by:
   * department" (§1). See seam notes for the §11 `department_id` mapping.
   */
  department: string;
  /** Owner of the item, or `null` when routed to a department queue (§1). */
  assignee_id: string | null;
  /** Optional due date; feeds derived health (overdue → at risk/blocked). */
  due_date: string | null;
  /** Soft-archived (deactivated) flag. Archived items stay visible but de-emphasized; the row menu toggles it. Absent ⇒ active. NOT a lifecycle status — phase remains the only stored lifecycle. */
  archived?: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A task — the atom (§1, bottom of the object ladder). One action one person
 * takes, with the fixed three-state lifecycle defined by {@link TaskStatus}.
 * Lives under a work item (its `work_item_id`).
 */
export interface Task {
  readonly id: string;
  work_item_id: string;
  title: string;
  /** Task status triad (§1 / §11) — never appears on work items. */
  status: TaskStatus;
  /** Optional due date; an overdue incomplete task raises item health. */
  due_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * The editable surface of a work item, shared VERBATIM by the repository
 * (`update`), the hook (`update`), and the Editor (`onSave`). Excludes managed
 * fields (`id`, `created_at`, `updated_at`) and the derived `health` so they can
 * never drift across those three call sites.
 *
 * `source` is deliberately EXCLUDED: provenance is recorded once at creation and
 * is display-only (the UI ships `ProvenanceChip`, not a source picker), so it is
 * never patchable. `type`, `priority`, and `tags` ARE editable (their `*Select` /
 * `TagInput` primitives exist).
 */
export type WorkItemPatch = Partial<
  Pick<
    WorkItem,
    | "title"
    | "phase"
    | "type"
    | "priority"
    | "tags"
    | "project_id"
    | "department"
    | "assignee_id"
    | "due_date"
    | "archived"
  >
>;

/**
 * The Table/list view-model row: a {@link WorkItem} plus its read-time derived
 * health and task roll-up counts. Produced by the hook so views render
 * `HealthBadge` directly without re-deriving (health stays computed-on-read,
 * never stored).
 */
export interface WorkItemRow extends WorkItem {
  /** Derived per {@link deriveHealth} at read time — never persisted. */
  readonly health: Health;
  /** Total tasks under this item. */
  readonly taskCount: number;
  /** Tasks whose status is `completed`. */
  readonly completedTaskCount: number;
}

/**
 * Pure health derivation (DESIGN §1 / §3 — health is ALWAYS derived, never
 * stored or hand-set). Maps `(workItem, tasks)` to a {@link Health} value
 * consistent with `@product-suite/ui`'s `Health` union.
 *
 * Rules (deterministic, in priority order):
 *  1. `blocked`  — the item is past its `due_date` and still has incomplete
 *     tasks (the work cannot land on time).
 *  2. `at_risk`  — any task is past its own `due_date` while still incomplete,
 *     OR the item is past `due_date` with no tasks to show progress.
 *  3. `on_track` — `phase === "done"`, or every task is completed, or nothing
 *     above fired.
 *
 * `now` is injected (defaulted to `Date.now()`) so callers and tests stay
 * deterministic — never read the clock implicitly.
 *
 * @param workItem - the item whose health to compute.
 * @param tasks - the item's tasks (may be empty).
 * @param now - reference epoch ms; defaults to the current time.
 */
export function deriveHealth(
  workItem: Pick<WorkItem, "phase" | "due_date">,
  tasks: ReadonlyArray<Pick<Task, "status" | "due_date">>,
  now: number = Date.now(),
): Health {
  const isComplete = (status: TaskStatus): boolean => status === "completed";
  const isOverdue = (due: string | null): boolean =>
    due !== null && Date.parse(due) < now;

  const incompleteTasks = tasks.filter((task) => !isComplete(task.status));
  const itemOverdue = isOverdue(workItem.due_date);

  // 1. Past due with work still open → blocked.
  if (itemOverdue && incompleteTasks.length > 0) {
    return "blocked";
  }

  // 2. An overdue-and-incomplete task, or an overdue item with no tasks → at risk.
  const hasOverdueOpenTask = incompleteTasks.some((task) =>
    isOverdue(task.due_date),
  );
  if (hasOverdueOpenTask || (itemOverdue && tasks.length === 0)) {
    return "at_risk";
  }

  // 3. Otherwise on track.
  return "on_track";
}
