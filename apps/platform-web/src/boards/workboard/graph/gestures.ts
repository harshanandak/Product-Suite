import {
  dependencyExists,
  wouldCreateCycle,
  type WorkItemDependency,
} from "@/data/work-items";

/**
 * Pure decision helpers for the Graph view's edge-drag gesture (DESIGN §5 / §10).
 *
 * Kept pure (no React, no React Flow) so the gesture's HEART — what makes a legal
 * dependency edge — is unit-tested directly, independent of the canvas. The view's
 * `isValidConnection` and `onConnect` are thin wrappers over these.
 */

/** The create-dependency input the hook/repository consume. */
export interface DependencyInput {
  source_item_id: string;
  target_item_id: string;
}

/**
 * Is a `source → target` edge legal against the CURRENT dependency set?
 *
 * MUST be called with the FULL dependency set — never a view-filtered subset —
 * so a cycle cannot be closed through a hidden node and crash dagre (DESIGN §5).
 * Rejects: a missing endpoint, a self-loop (covered by {@link wouldCreateCycle}),
 * a duplicate pair, or any edge that would close a directed cycle.
 *
 * @param dependencies - the full dependency set.
 * @param source - the dependent item id (drag origin).
 * @param target - the prerequisite item id (drag destination).
 */
export function canCreateDependency(
  dependencies: ReadonlyArray<WorkItemDependency>,
  source: string | null | undefined,
  target: string | null | undefined,
): boolean {
  if (!source || !target) return false;
  if (dependencyExists(dependencies, source, target)) return false;
  if (wouldCreateCycle(dependencies, source, target)) return false;
  return true;
}

/**
 * Map a React Flow connection (its source/target handles) to a
 * {@link DependencyInput}, or `null` when either endpoint is missing. Direction
 * convention: the drag goes `source → target`, i.e. "source depends on target".
 */
export function connectionToDependencyInput(connection: {
  source?: string | null;
  target?: string | null;
}): DependencyInput | null {
  const { source, target } = connection;
  if (!source || !target) return null;
  return { source_item_id: source, target_item_id: target };
}
