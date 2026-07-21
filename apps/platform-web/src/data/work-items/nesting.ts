/**
 * Task-nesting selectors (DESIGN §11 — one owned child tier).
 *
 * A Task is a work item with a `parent_id`; native nesting is one level deep (a
 * parent is itself top-level). These pure helpers turn a flat `WorkItem[]` into
 * the shapes the nested list + detail render: the parent→children buckets, the
 * top-level roots, and a parent's `n/m` progress fraction. They read the minimal
 * field set so both `WorkItem` and the view-model `WorkItemRow` flow through
 * unchanged.
 */
import type { WorkItem } from "./types";

/** The minimal shape the grouping selectors read from a work item. */
type Nestable = Pick<WorkItem, "id" | "parent_id">;

/** A parent's task roll-up: complete child Tasks out of the total (`n/m`). */
export interface TaskProgress {
  /** Child Tasks whose phase has reached `done`. */
  readonly completed: number;
  /** Total child Tasks under the parent. */
  readonly total: number;
}

/**
 * Group child work items (Tasks) by their `parent_id`, preserving input order
 * within each bucket. Top-level items (`parent_id === null`) are omitted, so the
 * map holds only the parent→children edges the nested list draws — a childless
 * root and a child's own id are never keys. Nesting is one level deep, so a
 * child never appears as a key.
 */
export function childrenByParent<T extends Nestable>(
  items: ReadonlyArray<T>,
): Map<string, T[]> {
  const byParent = new Map<string, T[]>();
  for (const item of items) {
    if (item.parent_id === null) continue;
    const bucket = byParent.get(item.parent_id);
    if (bucket) {
      bucket.push(item);
    } else {
      byParent.set(item.parent_id, [item]);
    }
  }
  return byParent;
}

/** Top-level items only (`parent_id === null`) — the roots the list renders. */
export function topLevelItems<T extends Nestable>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter((item) => item.parent_id === null);
}

/**
 * Roll a parent's child Tasks up to an `n/m` fraction: `completed` = children
 * whose `phase` is `done`, `total` = all children. An empty child list yields
 * `{ completed: 0, total: 0 }` (the parent shows no progress affordance).
 *
 * Completion keys off `phase === "done"` — the live done-signal in Phase 3
 * (health, kanban columns, and facets all still run on the `phase` enum). The
 * Phase-4 `phase → status_id` flip re-points this at the status category.
 */
export function taskProgress(
  children: ReadonlyArray<Pick<WorkItem, "phase">>,
): TaskProgress {
  let completed = 0;
  for (const child of children) {
    if (child.phase === "done") completed += 1;
  }
  return { completed, total: children.length };
}
