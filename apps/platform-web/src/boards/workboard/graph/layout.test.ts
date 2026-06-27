import { describe, expect, it } from "vitest";

import type { Phase } from "@/data/work-items";

import {
  filterVisibleEdges,
  LANE_WIDTH,
  layoutDependencies,
  layoutPhase,
  type LayoutEdge,
  type LayoutNode,
  NODE_WIDTH,
  PHASE_LANES,
  resolvePhaseFromPosition,
  topologySignature,
} from "./layout";

/**
 * Pure-helper coverage for the Graph view's layout module (DESIGN §4 / §5). No
 * React Flow is rendered here — this is where the bulk of the graph's behavioural
 * coverage lives, per the design's jsdom strategy. Phase mode lays nodes into four
 * VERTICAL columns (Kanban grammar); `resolvePhaseFromPosition` reads `centerX`.
 */

/** Build a minimal {@link LayoutNode} (phase defaults to `plan`). */
function node(id: string, phase: Phase = "plan"): LayoutNode {
  return { id, phase };
}

/** Build a minimal {@link LayoutEdge}. */
function edge(source: string, target: string): LayoutEdge {
  return { source, target };
}

describe("layoutDependencies", () => {
  it("returns an empty map for empty input (never feeds dagre a malformed graph)", () => {
    expect(layoutDependencies([], [])).toEqual(new Map());
  });

  it("places every node, including orphans with no edges", () => {
    const nodes = [node("a"), node("b"), node("orphan")];
    const positions = layoutDependencies(nodes, [edge("a", "b")]);
    expect(positions.has("a")).toBe(true);
    expect(positions.has("b")).toBe(true);
    expect(positions.has("orphan")).toBe(true);
    expect(positions.size).toBe(3);
  });

  it("ranks a multi-level chain left-to-right (x increases along the dependency direction)", () => {
    // a -> b -> c : in LR, the dependency direction advances along +x.
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c")];
    const positions = layoutDependencies(nodes, edges);
    const xa = positions.get("a")?.x ?? 0;
    const xb = positions.get("b")?.x ?? 0;
    const xc = positions.get("c")?.x ?? 0;
    expect(xa).toBeLessThan(xb);
    expect(xb).toBeLessThan(xc);
  });

  it("converts dagre centers to top-left positions (x = center - width/2)", () => {
    // A single isolated node centers at (width/2, height/2) -> top-left (0, 0).
    const positions = layoutDependencies([node("solo")], []);
    const pos = positions.get("solo");
    expect(pos).toBeDefined();
    expect(pos?.x).toBeCloseTo(0, 5);
    expect(pos?.y).toBeCloseTo(0, 5);
  });

  it("is deterministic — equal inputs yield deeply equal maps", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("a", "b"), edge("a", "c"), edge("c", "d")];
    const first = layoutDependencies(nodes, edges);
    const second = layoutDependencies(nodes, edges);
    expect(second).toEqual(first);
  });

  it("ignores an edge whose endpoint is not in the node set (no phantom node)", () => {
    const positions = layoutDependencies([node("a"), node("b")], [
      edge("a", "ghost"),
    ]);
    expect(positions.size).toBe(2);
    expect(positions.has("ghost")).toBe(false);
  });

  it("does not crash on a pre-existing cycle (acyclicer: greedy)", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    expect(() => layoutDependencies(nodes, edges)).not.toThrow();
    expect(layoutDependencies(nodes, edges).size).toBe(3);
  });
});

describe("layoutPhase", () => {
  it("always returns all four columns, even for empty input", () => {
    const { positions, lanes } = layoutPhase([], []);
    expect(positions.size).toBe(0);
    expect(lanes.map((lane) => lane.phase)).toEqual([...PHASE_LANES]);
  });

  it("lays out columns left-to-right in canonical phase order", () => {
    const { lanes } = layoutPhase([], []);
    expect(lanes[0].phase).toBe("plan");
    expect(lanes[0].x).toBe(0);
    expect(lanes[0].y).toBe(0);
    expect(lanes[1].x).toBe(LANE_WIDTH);
    expect(lanes[2].x).toBe(LANE_WIDTH * 2);
    expect(lanes[3].x).toBe(LANE_WIDTH * 3);
  });

  it("places each node within its own phase column (orphans included)", () => {
    const nodes = [
      node("p", "plan"),
      node("e", "execute"),
      node("r", "review"),
      node("d", "done"),
      node("orphan", "execute"),
    ];
    const { positions, lanes } = layoutPhase(nodes, []);
    const laneFor = (phase: Phase) =>
      lanes.find((lane) => lane.phase === phase);

    for (const id of ["p", "e", "r", "d", "orphan"]) {
      expect(positions.has(id)).toBe(true);
    }
    // Each node's center X must fall inside the column of its declared phase.
    const centerXInLane = (id: string, phase: Phase): boolean => {
      const pos = positions.get(id);
      const lane = laneFor(phase);
      if (!pos || !lane) return false;
      const centerX = pos.x + NODE_WIDTH / 2;
      return centerX >= lane.x && centerX < lane.x + lane.width;
    };
    expect(centerXInLane("p", "plan")).toBe(true);
    expect(centerXInLane("e", "execute")).toBe(true);
    expect(centerXInLane("orphan", "execute")).toBe(true);
    expect(centerXInLane("r", "review")).toBe(true);
    expect(centerXInLane("d", "done")).toBe(true);
  });

  it("packs multiple same-column nodes at increasing y (top-to-bottom)", () => {
    const nodes = [node("a", "plan"), node("b", "plan"), node("c", "plan")];
    const { positions } = layoutPhase(nodes, []);
    const ya = positions.get("a")?.y ?? 0;
    const yb = positions.get("b")?.y ?? 0;
    const yc = positions.get("c")?.y ?? 0;
    expect(ya).toBeLessThan(yb);
    expect(yb).toBeLessThan(yc);
  });

  it("is deterministic — equal inputs yield deeply equal layouts", () => {
    const nodes = [node("a", "plan"), node("b", "execute"), node("c", "plan")];
    const first = layoutPhase(nodes, []);
    const second = layoutPhase(nodes, []);
    expect(second.positions).toEqual(first.positions);
    expect(second.lanes).toEqual(first.lanes);
  });

  it("round-trips: a node placed in column P resolves back to P", () => {
    const nodes = [node("x", "review")];
    const { positions, lanes } = layoutPhase(nodes, []);
    const pos = positions.get("x");
    expect(pos).toBeDefined();
    const centerX = (pos?.x ?? 0) + NODE_WIDTH / 2;
    // Dragging from a different phase -> resolves to "review".
    expect(resolvePhaseFromPosition(centerX, lanes, "plan")).toBe("review");
  });
});

describe("resolvePhaseFromPosition", () => {
  const { lanes } = layoutPhase([], []);

  it("resolves a center within a column to that column's phase", () => {
    const reviewLane = lanes.find((lane) => lane.phase === "review");
    expect(reviewLane).toBeDefined();
    const centerX = (reviewLane?.x ?? 0) + (reviewLane?.width ?? 0) / 2;
    expect(resolvePhaseFromPosition(centerX, lanes, "plan")).toBe("review");
  });

  it("returns null for a same-column drop (no redundant patch)", () => {
    const planLane = lanes.find((lane) => lane.phase === "plan");
    const centerX = (planLane?.x ?? 0) + (planLane?.width ?? 0) / 2;
    expect(resolvePhaseFromPosition(centerX, lanes, "plan")).toBeNull();
  });

  it("returns null when the center is left of all columns", () => {
    expect(resolvePhaseFromPosition(-100, lanes, "plan")).toBeNull();
  });

  it("returns null when the center is right of all columns", () => {
    const totalWidth = LANE_WIDTH * PHASE_LANES.length;
    expect(resolvePhaseFromPosition(totalWidth + 50, lanes, "plan")).toBeNull();
  });

  it("treats a column's left edge as inside and its right edge as the next column", () => {
    // x at exactly lane[1].x belongs to lane[1] (execute), not lane[0] (plan).
    const executeLane = lanes[1];
    expect(executeLane.phase).toBe("execute");
    expect(resolvePhaseFromPosition(executeLane.x, lanes, "plan")).toBe(
      "execute",
    );
  });
});

describe("filterVisibleEdges", () => {
  it("keeps only edges whose both endpoints are visible", () => {
    const edges = [edge("a", "b"), edge("a", "hidden"), edge("hidden", "b")];
    const visible = new Set(["a", "b"]);
    const kept = filterVisibleEdges(edges, visible);
    expect(kept).toEqual([edge("a", "b")]);
  });

  it("drops an edge to a hidden node (no dangling edge to nowhere)", () => {
    const edges = [edge("a", "b")];
    const visible = new Set(["a"]);
    expect(filterVisibleEdges(edges, visible)).toEqual([]);
  });

  it("returns an empty array for an empty edge set", () => {
    expect(filterVisibleEdges([], new Set(["a"]))).toEqual([]);
  });
});

describe("topologySignature", () => {
  const nodes = [node("a", "plan"), node("b", "execute")];
  const edges = [edge("a", "b")];

  it("is order-independent — reordered inputs yield the same signature", () => {
    const reorderedNodes = [node("b", "execute"), node("a", "plan")];
    const sig1 = topologySignature(nodes, edges, "dependencies");
    const sig2 = topologySignature(reorderedNodes, edges, "dependencies");
    expect(sig2).toBe(sig1);
  });

  it("ignores positions — moving a node does not change the signature", () => {
    // Signature inputs carry no position; a drag cannot affect them, so two
    // calls with the same topology must match (this is the memo guarantee).
    const sig1 = topologySignature(nodes, edges, "dependencies");
    const sig2 = topologySignature(nodes, edges, "dependencies");
    expect(sig2).toBe(sig1);
  });

  it("changes when a node's phase changes (Phase-mode geometry depends on it)", () => {
    const moved = [node("a", "done"), node("b", "execute")];
    expect(topologySignature(moved, edges, "dependencies")).not.toBe(
      topologySignature(nodes, edges, "dependencies"),
    );
  });

  it("changes when an edge is added or removed", () => {
    const withExtra = [...edges, edge("b", "a")];
    expect(topologySignature(nodes, withExtra, "dependencies")).not.toBe(
      topologySignature(nodes, edges, "dependencies"),
    );
  });

  it("changes when the layout mode changes", () => {
    expect(topologySignature(nodes, edges, "phase")).not.toBe(
      topologySignature(nodes, edges, "dependencies"),
    );
  });

  it("changes when a node id changes", () => {
    const renamed = [node("a", "plan"), node("c", "execute")];
    expect(topologySignature(renamed, edges, "dependencies")).not.toBe(
      topologySignature(nodes, edges, "dependencies"),
    );
  });
});
