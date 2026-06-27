import dagre from "dagre";

import type { Phase } from "@/data/work-items";

/**
 * Pure layout helpers for the Workboard Graph view (DESIGN §4 / §5).
 *
 * Everything here is a pure function over plain data — NO React, NO React Flow,
 * NO canvas state — so the bulk of the graph's behaviour is unit-tested without
 * rendering `@xyflow/react` (which jsdom cannot size). The view layer adapts the
 * `WorkItemRow`s and `WorkItemDependency`s it holds into the minimal shapes
 * below, calls these helpers, and feeds the result straight into React Flow.
 *
 * Two layout modes (DESIGN §4), each a separate major axis because dagre cannot
 * rank by dependency depth AND pin nodes into phase bands simultaneously:
 *  - `"dependencies"` — dagre `rankdir="LR"`, nodes ranked by what-blocks-what.
 *  - `"phase"` — four vertical columns (`plan → execute → review → done`, the
 *    Kanban grammar); nodes pack top-to-bottom within their phase column and the
 *    column geometry is the drop target.
 *
 * Cycle detection is NOT reimplemented here — it lives in the data seam
 * (`wouldCreateCycle`) so the gesture guard and the store agree on a legal edge.
 */

/** The two switchable major axes of the graph (DESIGN §4). */
export type LayoutMode = "dependencies" | "phase";

/**
 * The phase lanes in canonical loop order (§1). Single source for the lane set
 * and their order — mirrors the Kanban board's `PHASE_COLUMNS`; never re-list
 * phases inline.
 */
export const PHASE_LANES: readonly Phase[] = ["plan", "execute", "review", "done"];

/**
 * Fixed node footprint fed to dagre, in layout coordinates. These MUST be at
 * least the real rendered card size or dagre packs node centers too close and
 * the cards visibly overlap. The card is `w-[240px]`; its measured height with a
 * full row set (title + phase/health + type/priority + owner/due + tags +
 * provenance) is ~203px — so we size at 240×210 (a small over-estimate so even a
 * tagged card never touches its neighbour). Identical per node keeps layout
 * deterministic and test-stable.
 */
export const NODE_WIDTH = 240;
/** @see {@link NODE_WIDTH} */
export const NODE_HEIGHT = 210;

/**
 * Dagre separation, in px. `RANK_SEP` is the gap between dependency LEVELS
 * (horizontal in LR mode); `NODE_SEP` is the gap between sibling nodes in the
 * same rank (vertical in LR) — edge-to-edge, on top of {@link NODE_HEIGHT}, so a
 * comfortable visible gutter keeps stacked cards from touching.
 */
const RANK_SEP = 120;
const NODE_SEP = 48;

/** Horizontal width of one phase column (Phase mode). */
export const LANE_WIDTH = 320;
/** Horizontal padding from a column's left edge — centers a NODE_WIDTH node. */
const LANE_PADDING_X = (LANE_WIDTH - NODE_WIDTH) / 2;
/** Vertical padding from a column's top edge to its first packed node. */
const LANE_PADDING_Y = 56;
/** Vertical gap between consecutive packed nodes inside a column (edge-to-edge,
 * on top of {@link NODE_HEIGHT}, so stacked cards keep a clear gutter). */
const LANE_NODE_GAP = 40;

/**
 * Minimal node shape the layout functions need: an id and the phase that decides
 * which lane it belongs to (Phase mode). The view passes a projection of its
 * `WorkItemRow`s; nothing else about the row affects geometry.
 */
export interface LayoutNode {
  readonly id: string;
  readonly phase: Phase;
}

/**
 * Minimal edge shape: the directed pair. The view passes a projection of the
 * (already visible-filtered) `WorkItemDependency`s.
 */
export interface LayoutEdge {
  readonly source: string;
  readonly target: string;
}

/** A computed top-left node position (React Flow's `node.position`). */
export interface NodePosition {
  readonly x: number;
  readonly y: number;
}

/** One swimlane's screen rectangle plus its phase (Phase mode). */
export interface LaneGeometry {
  readonly phase: Phase;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Result of {@link layoutPhase}: node positions plus the lane backgrounds the
 * view renders and {@link resolvePhaseFromPosition} reads as drop targets. */
export interface PhaseLayout {
  readonly positions: Map<string, NodePosition>;
  readonly lanes: readonly LaneGeometry[];
}

/**
 * Lay out nodes by dependency rank with dagre (`rankdir="LR"`) — Dependencies
 * mode (DESIGN §4, default). Orphan nodes (no edges) are still placed. Returns a
 * map from node id to its TOP-LEFT position (dagre reports node CENTERS; we
 * convert with `x - width/2`, `y - height/2`, the React Flow convention).
 *
 * `acyclicer: "greedy"` is set so a stray pre-existing cycle in `edges` cannot
 * crash layout (defence in depth — `isValidConnection` already blocks new
 * cycles; DESIGN §5). Layout is deterministic for a given topology: calling this
 * twice with equal inputs yields equal maps.
 *
 * @param nodes - the visible nodes to place.
 * @param edges - the visible dependency edges (both endpoints already in `nodes`).
 */
export function layoutDependencies(
  nodes: ReadonlyArray<LayoutNode>,
  edges: ReadonlyArray<LayoutEdge>,
): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (nodes.length === 0) return positions;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    acyclicer: "greedy",
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    nodeIds.add(node.id);
  }
  for (const edge of edges) {
    // Guard: dagre would implicitly create a phantom node for an endpoint not in
    // the node set. Skip such edges (the view filters them, but stay defensive).
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  for (const node of nodes) {
    const laidOut = graph.node(node.id);
    positions.set(node.id, {
      x: laidOut.x - laidOut.width / 2,
      y: laidOut.y - laidOut.height / 2,
    });
  }
  return positions;
}

/**
 * Lay out nodes into four vertical phase columns — Phase mode (DESIGN §4, the
 * Kanban grammar). Each column is a fixed-width band; nodes pack top-to-bottom
 * within their phase's column (orphans included). Returns both the node positions
 * and the column geometry — the latter is the literal drop target read back by
 * {@link resolvePhaseFromPosition} on drag-stop, and the background the view
 * renders. The columns always exist (all four) even when no node falls in them,
 * so an empty board still shows the column scaffold.
 *
 * Within-column order is the incoming `nodes` order (stable); `edges` do not
 * affect Phase-mode geometry (dependency rank is not the axis here).
 *
 * @param nodes - the visible nodes to place into columns.
 * @param _edges - unused in Phase mode; accepted for a uniform layout signature.
 */
export function layoutPhase(
  nodes: ReadonlyArray<LayoutNode>,
  _edges: ReadonlyArray<LayoutEdge> = [],
): PhaseLayout {
  const positions = new Map<string, NodePosition>();

  // Bucket nodes per column so a column grows tall enough to hold its members.
  const perLane = new Map<Phase, LayoutNode[]>();
  for (const phase of PHASE_LANES) perLane.set(phase, []);
  for (const node of nodes) {
    perLane.get(node.phase)?.push(node);
  }

  const strideY = NODE_HEIGHT + LANE_NODE_GAP;
  let maxLaneHeight = 0;
  for (const phase of PHASE_LANES) {
    const count = perLane.get(phase)?.length ?? 0;
    const contentHeight = count > 0 ? count * strideY - LANE_NODE_GAP : 0;
    const laneHeight = contentHeight + LANE_PADDING_Y * 2;
    if (laneHeight > maxLaneHeight) maxLaneHeight = laneHeight;
  }
  // Every column shares the tallest height so the bands line up cleanly.
  const laneHeight = Math.max(maxLaneHeight, NODE_HEIGHT + LANE_PADDING_Y * 2);

  const lanes: LaneGeometry[] = [];
  PHASE_LANES.forEach((phase, laneIndex) => {
    const laneX = laneIndex * LANE_WIDTH;
    lanes.push({
      phase,
      x: laneX,
      y: 0,
      width: LANE_WIDTH,
      height: laneHeight,
    });

    const members = perLane.get(phase) ?? [];
    members.forEach((node, memberIndex) => {
      positions.set(node.id, {
        x: laneX + LANE_PADDING_X,
        y: LANE_PADDING_Y + memberIndex * strideY,
      });
    });
  });

  return { positions, lanes };
}

/**
 * Resolve which phase column a dropped node's CENTER landed in — the Phase-mode
 * drag→phase gesture (DESIGN §4 / §5), the analogue of Kanban's
 * `resolvePhaseChange`. Columns are vertical bands so the horizontal center
 * (`centerX`) selects the column.
 *
 * Returns `null` (no phase change — caller fires nothing) when:
 *  - `centerX` falls outside every column, OR
 *  - the resolved column equals `currentPhase` (a same-column drop is a no-op;
 *    never fire a redundant patch — mirrors `resolvePhaseChange`).
 *
 * @param centerX - the dropped node's horizontal center, in lane coordinates.
 * @param lanes - the column geometry from {@link layoutPhase}.
 * @param currentPhase - the dragged node's current phase.
 */
export function resolvePhaseFromPosition(
  centerX: number,
  lanes: readonly LaneGeometry[],
  currentPhase: Phase,
): Phase | null {
  const lane = lanes.find(
    (candidate) =>
      centerX >= candidate.x && centerX < candidate.x + candidate.width,
  );
  if (lane === undefined) return null;
  return lane.phase === currentPhase ? null : lane.phase;
}

/**
 * Keep only edges whose BOTH endpoints are in the visible node-id set (DESIGN §5:
 * "edges are computed only between visible node ids; a dependency whose endpoint
 * is hidden by the current filter is dropped — no dangling edge to nowhere").
 *
 * NOTE the asymmetry called out in §5: this filters what is RENDERED. Connection
 * VALIDATION (`isValidConnection` / `wouldCreateCycle`) must always run against
 * the FULL dependency set, never this filtered subset — otherwise a cycle could
 * be closed through a hidden node and crash dagre.
 *
 * @param edges - all dependency records.
 * @param visibleIds - the ids of the currently visible nodes.
 */
export function filterVisibleEdges<E extends LayoutEdge>(
  edges: ReadonlyArray<E>,
  visibleIds: ReadonlySet<string>,
): E[] {
  return edges.filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );
}

/**
 * A stable, position-INDEPENDENT signature of the graph's topology, used to
 * memoize layout (DESIGN §3): dagre re-runs ONLY when this string changes — i.e.
 * when the node-id set, a node's phase, the edge pairs, or the layout mode
 * change. It deliberately ignores node POSITIONS so a drag (which moves a node
 * but changes no topology) never re-triggers the O(V+E) layout.
 *
 * Ids and edge pairs are sorted before joining, so a reordered input array yields
 * the SAME signature (order-independence). Node phases are included because Phase
 * mode's geometry depends on them.
 *
 * @param nodes - the nodes (id + phase contribute).
 * @param edges - the edges (source→target pairs contribute).
 * @param mode - the active layout mode (a mode switch changes the layout).
 */
export function topologySignature(
  nodes: ReadonlyArray<LayoutNode>,
  edges: ReadonlyArray<LayoutEdge>,
  mode: LayoutMode,
): string {
  const nodeKeys = nodes
    .map((node) => `${node.id}:${node.phase}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const edgeKeys = edges
    .map((edge) => `${edge.source}->${edge.target}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${mode}|N:${nodeKeys.join(",")}|E:${edgeKeys.join(",")}`;
}
