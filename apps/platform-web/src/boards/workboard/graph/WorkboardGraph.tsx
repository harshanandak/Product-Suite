import * as React from "react";

import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnConnect,
  type OnNodeDrag,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ViewportPortal,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import {
  Button,
  EmptyState,
  ErrorState,
  PHASE_LABELS,
  Tabs,
  TabsList,
  TabsTrigger,
  TooltipProvider,
} from "@product-suite/ui";

import {
  type Owner,
  type Phase,
  type WorkItem,
  type WorkItemDependency,
  type WorkItemPatch,
  type WorkItemRow,
} from "@/data/work-items";

import { canCreateDependency, connectionToDependencyInput } from "./gestures";
import {
  type LaneGeometry,
  type LayoutEdge,
  type LayoutMode,
  type LayoutNode,
  layoutDependencies,
  layoutPhase,
  NODE_WIDTH,
  resolvePhaseFromPosition,
  topologySignature,
} from "./layout";
import { WorkItemNode, type WorkItemNodeData } from "./WorkItemNode";

/**
 * Workboard GRAPH view — Slice A (DESIGN §4 / §5 / §10).
 *
 * The third peer of Table + Kanban: nodes are work items, edges are persisted
 * dependency records. Two switchable major axes (a one-click toggle):
 *  - **Dependencies** (default) — dagre `rankdir="LR"`, ranked by what-blocks-what.
 *  - **Phase** — four vertical columns (`plan → execute → review → done`, the
 *    Kanban grammar); a node dropped into another column changes its phase.
 *
 * GESTURES ARE REAL MUTATIONS, never canvas-local state (DESIGN §10 — the
 * documented prior-failure trap). Edges are FULLY DERIVED from the `dependencies`
 * prop: `onConnect` calls ONLY `onAddDependency` (never `setEdges`), edge delete
 * calls ONLY `onRemoveDependency`; the optimistic hook reflows `dependencies` and
 * the edge appears/disappears on the next render. Node positions live in React
 * Flow state (transient drag pixels only) but the node DATA is derived — the work
 * item record is never stored in canvas state.
 *
 * Validation asymmetry (DESIGN §5): connection validity ({@link canCreateDependency})
 * runs against the FULL `dependencies` prop (reject self-loop, duplicate, cycle),
 * while rendered edges are filtered to only those whose BOTH endpoints are in the
 * visible row set — so a cycle can never be closed through a hidden node and crash
 * dagre.
 *
 * Read-only (DESIGN §5): when the mutators are absent, nodes are not draggable,
 * the connection Handles are disabled, and the Delete-to-remove key is unbound —
 * mirroring the Kanban `draggable` gating.
 *
 * Performance (DESIGN §3): module-level `nodeTypes`/`edgeTypes`, `React.memo`
 * node, `onlyRenderVisibleElements`, layout memoized on TOPOLOGY (not render),
 * bounded zoom + `fitView`, static (non-animated) edges, `nodeDragThreshold`.
 * The whole view is lazy-loaded by the screen so `@xyflow/react` + its CSS load
 * only when the Graph tab opens.
 */
export interface WorkboardGraphProps {
  /** Rows already searched + filtered by the parent (same as Table/Kanban). */
  rows: WorkItemRow[];
  /**
   * The FULL dependency set. Used for BOTH connection validation (cycle/duplicate
   * against everything, including hidden edges) and — after visible-edge
   * filtering — for the rendered edges (DESIGN §5 asymmetry).
   */
  dependencies: WorkItemDependency[];
  /** Owner lookup for each node's owner chip. */
  owners: ReadonlyArray<Owner>;
  /** Render the loading skeleton during the initial load. */
  loading: boolean;
  /** Set on load failure; renders an ErrorState with a retry path. */
  error: Error | null;
  /** Wired to `hook.refetch`; used by the error state's retry button. */
  onRetry?: () => void;
  /** Node activation → parent opens the editor Sheet with this item. */
  onSelectItem: (item: WorkItemRow) => void;
  /** Optional phase mutator (inline pill + Phase-mode column drop). */
  onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
  /** Optional edge-create mutator (drag a connection between two nodes). */
  onAddDependency?: (input: {
    source_item_id: string;
    target_item_id: string;
  }) => Promise<WorkItemDependency>;
  /** Optional edge-remove mutator (select an edge + Delete). */
  onRemoveDependency?: (id: string) => Promise<void>;
  /** Optional filter cluster, rendered floating in a top-left in-canvas Panel. */
  filters?: React.ReactNode;
}

/**
 * React Flow node/edge type registries — MUST live at module level (DESIGN §3:
 * recreating them per render forces a full remount, the #1 React Flow footgun).
 */
const NODE_TYPES: NodeTypes = { workItem: WorkItemNode };
const EDGE_TYPES: EdgeTypes = {};

/** Bounded zoom so a huge graph never opens zoomed into a single node (§3). */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;

/** Click-vs-drag gate: travel (px) before a drag begins (Kanban parity, §3). */
const NODE_DRAG_THRESHOLD = 6;

/** Stable keys for the fixed-count loading skeleton placeholders. */
const SKELETON_KEYS = ["g1", "g2", "g3", "g4", "g5", "g6"] as const;

/**
 * Static edge defaults (DESIGN §3): a plain arrow marker, NEVER `animated`
 * (animated edges repaint every frame — banned at scale).
 */
const DEFAULT_EDGE_OPTIONS = {
  markerEnd: { type: MarkerType.ArrowClosed },
} as const;

/** Open at a sane zoom — never magnified into one node (§3). */
const FIT_VIEW_OPTIONS = { maxZoom: 1 } as const;

/** The graph node carrying our typed data payload. */
type GraphNode = Node<WorkItemNodeData, "workItem">;

/** Project a row to the minimal layout node shape the helpers consume. */
function toLayoutNode(row: WorkItemRow): LayoutNode {
  return { id: row.id, phase: row.phase };
}

/** Project a dependency to the minimal layout edge shape. */
function toLayoutEdge(dependency: WorkItemDependency): LayoutEdge {
  return { source: dependency.source_item_id, target: dependency.target_item_id };
}

/**
 * Build the rendered React Flow edges from the visible dependency records. The
 * edge `id` IS the dependency record id, so `onRemoveDependency(edge.id)` targets
 * the right record (DESIGN §10 — edges are records, not decoration).
 */
function buildEdges(visibleDependencies: WorkItemDependency[]): Edge[] {
  return visibleDependencies.map((dependency) => ({
    id: dependency.id,
    source: dependency.source_item_id,
    target: dependency.target_item_id,
  }));
}

/** Loading state: a labelled skeleton grid mirroring the Kanban/Table pattern. */
function LoadingSkeleton() {
  return (
    <div
      data-testid="workboard-graph-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="grid h-[60vh] grid-cols-2 gap-4 sm:grid-cols-3"
    >
      <span className="sr-only">Loading work items…</span>
      {SKELETON_KEYS.map((key) => (
        <div
          key={key}
          aria-hidden="true"
          className="h-32 w-full animate-pulse rounded-lg bg-muted"
        />
      ))}
    </div>
  );
}

/** Background phase columns for Phase mode (non-interactive presentation). */
function PhaseLanes({ lanes }: Readonly<{ lanes: readonly LaneGeometry[] }>) {
  return (
    <>
      {lanes.map((lane) => (
        <div
          key={lane.phase}
          data-testid="graph-phase-lane"
          data-phase={lane.phase}
          className="pointer-events-none absolute rounded-md border border-dashed border-border bg-muted/20"
          style={{
            left: lane.x,
            top: lane.y,
            width: lane.width,
            height: lane.height,
          }}
        >
          <span className="absolute left-2 top-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {PHASE_LABELS[lane.phase]}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * The layout-mode toggle + Auto-layout button — a bare floating control cluster
 * that lives INSIDE the canvas (via a React Flow {@link Panel}). No card chrome
 * or borders: the segmented Tabs carry their own pill background and Auto-layout
 * is a plain ghost button, consistent with the app's existing buttons and with
 * React Flow's own bare floating Controls.
 */
function GraphToolbar({
  mode,
  onModeChange,
  onAutoLayout,
}: Readonly<{
  mode: LayoutMode;
  onModeChange: (next: string) => void;
  onAutoLayout: () => void;
}>) {
  return (
    <div className="flex items-center gap-2">
      <Tabs value={mode} onValueChange={onModeChange}>
        <TabsList aria-label="Graph layout">
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="phase">Status</TabsTrigger>
        </TabsList>
      </Tabs>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="graph-auto-layout"
        onClick={onAutoLayout}
      >
        Auto-layout
      </Button>
    </div>
  );
}

/** Inputs the element-derivation hook needs from the view. */
interface GraphElementsParams {
  rows: WorkItemRow[];
  dependencies: WorkItemDependency[];
  owners: ReadonlyArray<Owner>;
  mode: LayoutMode;
  relayoutNonce: number;
  connectable: boolean;
  draggable: boolean;
  onSelectItem: (item: WorkItemRow) => void;
  onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}

/** What {@link useGraphElements} hands back to the view. */
interface GraphElements {
  nodes: GraphNode[];
  edges: Edge[];
  lanes: readonly LaneGeometry[];
  phaseById: Map<string, Phase>;
  onNodesChange: (changes: NodeChange<GraphNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
}

/**
 * Derive the React Flow node/edge model from the props (extracted from the view
 * so the component body stays small and SonarCloud-clean). Positions come from
 * the active layout (memoized on TOPOLOGY, never on render/drag — DESIGN §3); node
 * DATA comes from the rows. React Flow needs its own node/edge state for transient
 * drag pixels, but the DATA stays derived (DESIGN §10).
 */
function useGraphElements({
  rows,
  dependencies,
  owners,
  mode,
  relayoutNonce,
  connectable,
  draggable,
  onSelectItem,
  onUpdateItem,
}: GraphElementsParams): GraphElements {
  // Visible node-id set drives the render-edge filter (DESIGN §5). Validation,
  // by contrast, always uses the FULL `dependencies` prop.
  const visibleIds = React.useMemo(
    () => new Set(rows.map((row) => row.id)),
    [rows],
  );

  const layoutNodes = React.useMemo(() => rows.map(toLayoutNode), [rows]);

  // Render-edge filter (DESIGN §5): keep only dependency records whose BOTH
  // endpoints are visible (carry the original record id for onRemoveDependency).
  const visibleDependencies = React.useMemo(
    () =>
      dependencies.filter(
        (dependency) =>
          visibleIds.has(dependency.source_item_id) &&
          visibleIds.has(dependency.target_item_id),
      ),
    [dependencies, visibleIds],
  );

  const layoutEdges = React.useMemo(
    () => visibleDependencies.map(toLayoutEdge),
    [visibleDependencies],
  );

  // Topology signature: layout recomputes ONLY when the id set / phases / edge
  // pairs / mode change — never on a pan, zoom, or position drag (DESIGN §3).
  const signature = React.useMemo(
    () => topologySignature(layoutNodes, layoutEdges, mode),
    [layoutNodes, layoutEdges, mode],
  );

  // Phase-mode layout (positions + column geometry) computed once when in Phase
  // mode; both `derivedNodes` and `lanes` read it (no double layout).
  const phaseLayout = React.useMemo(
    () => (mode === "phase" ? layoutPhase(layoutNodes, layoutEdges) : null),
    [mode, layoutNodes, layoutEdges],
  );

  const derivedNodes = React.useMemo<GraphNode[]>(() => {
    const positions =
      phaseLayout !== null
        ? phaseLayout.positions
        : layoutDependencies(layoutNodes, layoutEdges);

    return rows.map((row) => {
      const position = positions.get(row.id) ?? { x: 0, y: 0 };
      const data: WorkItemNodeData = {
        row,
        owners,
        connectable,
        onSelectItem,
        onUpdateItem,
      };
      return { id: row.id, type: "workItem", position, data, draggable };
    });
    // `signature` encodes ids/phases/edges/mode; `relayoutNonce` forces a re-run;
    // `phaseLayout` is itself memoized on the same topology. The remaining deps
    // feed node DATA, not geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    signature,
    relayoutNonce,
    phaseLayout,
    rows,
    owners,
    connectable,
    draggable,
    onSelectItem,
    onUpdateItem,
  ]);

  const lanes = React.useMemo<readonly LaneGeometry[]>(
    () => phaseLayout?.lanes ?? [],
    [phaseLayout],
  );

  const derivedEdges = React.useMemo(
    () => buildEdges(visibleDependencies),
    [visibleDependencies],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>(derivedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(derivedEdges);

  React.useEffect(() => {
    setNodes(derivedNodes);
  }, [derivedNodes, setNodes]);

  React.useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  // Phase lookup for the column-drop gesture (current phase of a dragged node).
  const phaseById = React.useMemo(() => {
    const map = new Map<string, Phase>();
    for (const row of rows) map.set(row.id, row.phase);
    return map;
  }, [rows]);

  return { nodes, edges, lanes, phaseById, onNodesChange, onEdgesChange };
}

/**
 * Inner graph (assumes a {@link ReactFlowProvider} ancestor so `useReactFlow`
 * works for the Auto-layout `fitView`).
 */
function WorkboardGraphInner({
  rows,
  dependencies,
  owners,
  onSelectItem,
  onUpdateItem,
  onAddDependency,
  onRemoveDependency,
  filters,
}: Readonly<Omit<WorkboardGraphProps, "loading" | "error" | "onRetry">>) {
  const [mode, setMode] = React.useState<LayoutMode>("dependencies");
  const [relayoutNonce, setRelayoutNonce] = React.useState(0);
  const { fitView } = useReactFlow();

  const connectable = onAddDependency !== undefined;
  const draggable = onUpdateItem !== undefined;

  const { nodes, edges, lanes, phaseById, onNodesChange, onEdgesChange } =
    useGraphElements({
      rows,
      dependencies,
      owners,
      mode,
      relayoutNonce,
      connectable,
      draggable,
      onSelectItem,
      onUpdateItem,
    });

  // Connection validity (DESIGN §5) — runs against the FULL `dependencies` prop,
  // NOT the visible subset (see {@link canCreateDependency}).
  const isValidConnection = React.useCallback(
    (connection: Connection | Edge): boolean =>
      canCreateDependency(dependencies, connection.source, connection.target),
    [dependencies],
  );

  // Edge-drag → create a dependency. Calls ONLY `onAddDependency` (DESIGN §10) —
  // never `setEdges`. The optimistic hook reflows `dependencies`; the edge then
  // appears via the derived-edges effect. A failed add simply never renders.
  const handleConnect = React.useCallback<OnConnect>(
    (connection) => {
      if (!onAddDependency) return;
      const input = connectionToDependencyInput(connection);
      if (input === null) return;
      if (!canCreateDependency(dependencies, input.source_item_id, input.target_item_id)) {
        return;
      }
      onAddDependency(input).catch(() => undefined);
    },
    [onAddDependency, dependencies],
  );

  // Edge select + Delete → remove the dependency. Calls ONLY `onRemoveDependency`
  // with the edge id (== record id; DESIGN §10) — never `setEdges`.
  const handleEdgesDelete = React.useCallback(
    (deleted: Edge[]) => {
      if (!onRemoveDependency) return;
      for (const edge of deleted) {
        onRemoveDependency(edge.id).catch(() => undefined);
      }
    },
    [onRemoveDependency],
  );

  // Phase mode: a node dropped into another column → change phase (DESIGN §4/§5).
  // Resolves the column from the dropped node's horizontal center; a same-column
  // (or out-of-column) drop is a no-op. Calls `onUpdateItem(id, { phase })`.
  const handleNodeDragStop = React.useCallback<OnNodeDrag>(
    (_event, node) => {
      if (!onUpdateItem || mode !== "phase") return;
      const currentPhase = phaseById.get(node.id);
      if (currentPhase === undefined) return;
      const centerX = node.position.x + NODE_WIDTH / 2;
      const nextPhase = resolvePhaseFromPosition(centerX, lanes, currentPhase);
      if (nextPhase === null) return;
      onUpdateItem(node.id, { phase: nextPhase }).catch(() => undefined);
    },
    [onUpdateItem, mode, phaseById, lanes],
  );

  // Auto-layout: re-run the active layout (presentation only — DESIGN §4).
  const handleAutoLayout = React.useCallback(() => {
    setRelayoutNonce((nonce) => nonce + 1);
    requestAnimationFrame(() => {
      fitView(FIT_VIEW_OPTIONS);
    });
  }, [fitView]);

  const handleModeChange = React.useCallback((next: string) => {
    setMode(next === "phase" ? "phase" : "dependencies");
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workboard-graph">
      {/* Full-bleed canvas — NO border/frame: the Graph is a full-page sub-board,
          so it takes the whole content area. The layout controls float INSIDE the
          canvas via a React Flow <Panel> (below), not in a bar above it.
          `min-h-[420px]` floors the height if the host gives no definite one. */}
      <div
        data-testid="graph-canvas"
        className="relative min-h-[420px] w-full flex-1 overflow-hidden"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onEdgesDelete={handleEdgesDelete}
          onNodeDragStop={handleNodeDragStop}
          isValidConnection={isValidConnection}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          nodeDragThreshold={NODE_DRAG_THRESHOLD}
          nodesDraggable={draggable}
          nodesConnectable={connectable}
          // Delete is for dependency EDGES only — never nodes. React Flow's
          // default delete path would otherwise let a selected node vanish from
          // local canvas state until the graph remounts. Cancel any deletion
          // that targets a node; edge-only deletions proceed.
          onBeforeDelete={({ nodes }) => Promise.resolve(nodes.length === 0)}
          elementsSelectable
          onlyRenderVisibleElements
          deleteKeyCode={onRemoveDependency ? "Delete" : null}
          proOptions={{ hideAttribution: true }}
        >
          {/* Filters float top-left; view controls float top-right (both inside
              the canvas, overlaying it). */}
          {filters ? <Panel position="top-left">{filters}</Panel> : null}
          <Panel position="top-right">
            <GraphToolbar
              mode={mode}
              onModeChange={handleModeChange}
              onAutoLayout={handleAutoLayout}
            />
          </Panel>
          {/* Lane backgrounds live INSIDE the viewport portal so they pan/zoom
              WITH the nodes (same coordinate system) — rendering them as plain
              container children desyncs them from the fitView transform. */}
          {mode === "phase" ? (
            <ViewportPortal>
              <PhaseLanes lanes={lanes} />
            </ViewportPortal>
          ) : null}
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

/**
 * Workboard graph — switchable dependency/phase canvas over work items.
 *
 * @see WorkboardGraphProps for the prop contract.
 */
export function WorkboardGraph({
  rows,
  dependencies,
  owners,
  loading,
  error,
  onRetry,
  onSelectItem,
  onUpdateItem,
  onAddDependency,
  onRemoveDependency,
  filters,
}: Readonly<WorkboardGraphProps>) {
  if (loading) {
    return <LoadingSkeleton />;
  }
  if (error) {
    return (
      <ErrorState
        title="Could not load work items"
        action={
          onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No work items"
        description="Nothing matches the current filters yet."
      />
    );
  }

  // ReactFlowProvider lives here so the lazy chunk owns it and `useReactFlow`
  // (Auto-layout's fitView) resolves inside the canvas.
  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <WorkboardGraphInner
          rows={rows}
          dependencies={dependencies}
          owners={owners}
          onSelectItem={onSelectItem}
          onUpdateItem={onUpdateItem}
          onAddDependency={onAddDependency}
          onRemoveDependency={onRemoveDependency}
          filters={filters}
        />
      </ReactFlowProvider>
    </TooltipProvider>
  );
}

export default WorkboardGraph;
