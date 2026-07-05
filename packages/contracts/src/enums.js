/**
 * Framework-neutral domain enums (DESIGN §5). The single runtime source of
 * truth for the work-item enum vocabularies — values, human labels, and display
 * order — so the React `@product-suite/ui` components, the Python backend, and
 * the SDK all agree on the same closed sets instead of each re-declaring them.
 *
 * Plain ESM (no React, no TS) mirroring the other `src/*.js` contracts. The
 * canonical machine-readable mirror lives in `../contracts/enums.json`; the
 * union/label/order TYPES live in `./index.d.ts`. A tri-directional sync test
 * (`enums.test.ts`) fails if any of the three ever drift apart.
 */

/** Universal work-item phase loop: plan → execute → review → done (§1 / §5). */
export const PHASE_VALUES = ["plan", "execute", "review", "done"];

export const PHASE_LABELS = {
  plan: "Plan",
  execute: "Execute",
  review: "Review",
  done: "Done",
};

/** Canonical loop order (same as declaration order). Source for selects/sorts. */
export const PHASE_ORDER = ["plan", "execute", "review", "done"];

/** Task / agent-run status triad — never on work items (§5 / §11). */
export const TASK_STATUS_VALUES = ["todo", "in_progress", "completed"];

export const STATUS_LABELS = {
  todo: "To-do",
  in_progress: "In progress",
  completed: "Completed",
};

export const TASK_STATUS_ORDER = ["todo", "in_progress", "completed"];

/** Derived work-item health (never stored — §3 / §5). */
export const HEALTH_VALUES = ["on_track", "at_risk", "blocked"];

export const HEALTH_LABELS = {
  on_track: "On track",
  at_risk: "At risk",
  blocked: "Blocked",
};

export const HEALTH_ORDER = ["on_track", "at_risk", "blocked"];

/** Stored work-item priority / severity (§5 / §11). */
export const PRIORITY_VALUES = ["critical", "high", "medium", "low"];

export const PRIORITY_LABELS = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Severity order, highest → lowest. Single source for selects/sorts. */
export const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

/** Kind of work a work item represents (§5 / §11). */
export const WORK_ITEM_TYPE_VALUES = ["feature", "bug", "chore", "research"];

export const WORK_ITEM_TYPE_LABELS = {
  feature: "Feature",
  bug: "Bug",
  chore: "Chore",
  research: "Research",
};

/** Display order. Single source for selects/sorts. */
export const WORK_ITEM_TYPE_ORDER = ["feature", "bug", "chore", "research"];

/** Work-item provenance — where an object came from (§5 / §11). */
export const WORK_ITEM_SOURCE_VALUES = ["manual", "meeting", "agent", "feedback"];

export const WORK_ITEM_SOURCE_LABELS = {
  manual: "Manual",
  meeting: "Meeting",
  agent: "Agent",
  feedback: "Feedback",
};

export const WORK_ITEM_SOURCE_ORDER = ["manual", "meeting", "agent", "feedback"];

/**
 * Sentinel for the "Unassigned" owner option. Radix `Select` forbids
 * empty-string item values, so the picker carries this value and maps it
 * to/from `null` at the component boundary. Reserved: no real assignee id may
 * equal it.
 */
export const ASSIGNEE_UNASSIGNED_VALUE = "__unassigned__";

/**
 * Canonical mirror of `../contracts/enums.json` (deep-equal in the sync test).
 * Consumers that want to iterate the whole vocabulary read this object; the
 * named constants above are the ergonomic accessors for individual enums.
 */
export const enums = {
  phase: { values: PHASE_VALUES, labels: PHASE_LABELS, order: PHASE_ORDER },
  taskStatus: {
    values: TASK_STATUS_VALUES,
    labels: STATUS_LABELS,
    order: TASK_STATUS_ORDER,
  },
  health: { values: HEALTH_VALUES, labels: HEALTH_LABELS, order: HEALTH_ORDER },
  priority: {
    values: PRIORITY_VALUES,
    labels: PRIORITY_LABELS,
    order: PRIORITY_ORDER,
  },
  workItemType: {
    values: WORK_ITEM_TYPE_VALUES,
    labels: WORK_ITEM_TYPE_LABELS,
    order: WORK_ITEM_TYPE_ORDER,
  },
  workItemSource: {
    values: WORK_ITEM_SOURCE_VALUES,
    labels: WORK_ITEM_SOURCE_LABELS,
    order: WORK_ITEM_SOURCE_ORDER,
  },
  assignee: { unassignedValue: ASSIGNEE_UNASSIGNED_VALUE },
};
