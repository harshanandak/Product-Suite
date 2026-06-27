import type { WorkItemDependency } from "./types";

/**
 * Pure dependency-graph helpers shared by the repository's write guard and the
 * graph view's `isValidConnection`. Kept in the data layer (not the view) because
 * they reason about the dependency DATA model, and BOTH the seam and the canvas
 * must agree on what a legal edge is (DESIGN §10: gestures are real mutations —
 * the same rule has to hold at the gesture and at the store).
 *
 * Edge direction convention (see {@link WorkItemDependency}): an edge points
 * `source_item_id → target_item_id` ("source depends on target").
 */

/**
 * Adjacency map `source_item_id → Set<target_item_id>` over a dependency set —
 * i.e. each item mapped to the items it depends on.
 */
export function buildDependencyAdjacency(
  dependencies: ReadonlyArray<WorkItemDependency>,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const dependency of dependencies) {
    const targets = adjacency.get(dependency.source_item_id);
    if (targets) {
      targets.add(dependency.target_item_id);
    } else {
      adjacency.set(dependency.source_item_id, new Set([dependency.target_item_id]));
    }
  }
  return adjacency;
}

/**
 * Would adding the edge `source → target` close a directed cycle in the EXISTING
 * dependency set? True iff `target` can already reach `source` by following
 * existing `source → target` edges (the new edge would then complete the loop), or
 * the edge is a self-loop (`source === target`).
 *
 * IMPORTANT: callers must pass the FULL dependency set, never a view-filtered
 * subset — otherwise a cycle could be closed through a hidden node and crash
 * dagre's layout (which assumes a DAG). See the design doc §5.
 */
export function wouldCreateCycle(
  dependencies: ReadonlyArray<WorkItemDependency>,
  sourceItemId: string,
  targetItemId: string,
): boolean {
  // A self-loop is the degenerate cycle.
  if (sourceItemId === targetItemId) return true;

  const adjacency = buildDependencyAdjacency(dependencies);

  // DFS from `target`: if it can reach `source`, then `source → target` closes a
  // loop. Iterative (explicit stack) so a deep chain never overflows.
  const stack: string[] = [targetItemId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node === sourceItemId) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    const next = adjacency.get(node);
    if (next) {
      for (const neighbor of next) stack.push(neighbor);
    }
  }
  return false;
}

/** True iff a `source → target` edge already exists in `dependencies`. */
export function dependencyExists(
  dependencies: ReadonlyArray<WorkItemDependency>,
  sourceItemId: string,
  targetItemId: string,
): boolean {
  return dependencies.some(
    (dependency) =>
      dependency.source_item_id === sourceItemId &&
      dependency.target_item_id === targetItemId,
  );
}
