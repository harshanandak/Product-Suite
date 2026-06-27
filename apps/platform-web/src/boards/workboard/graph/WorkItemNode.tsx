import * as React from "react";

import { Handle, Position, type NodeProps } from "@xyflow/react";

import {
  Avatar,
  AvatarFallback,
  HealthBadge,
  type Phase,
  PhasePill,
  PhaseSelect,
  PriorityBadge,
  ProvenanceChip,
  TagList,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  WorkItemTypeBadge,
  cn,
} from "@product-suite/ui";

import type { Owner, WorkItemPatch, WorkItemRow } from "@/data/work-items";

/**
 * Custom React Flow node for the Workboard Graph view (DESIGN §4 / Slice A).
 *
 * Renders ONE {@link WorkItemRow} as a full-detail card mirroring the Kanban
 * card's field set (title, phase, health, type/priority badges, owner avatar,
 * due, tags, provenance) using the same shared `@product-suite/ui` primitives, so
 * the three views read identically. LOD tiers / clustering / compact rendering
 * are Slice B and intentionally NOT here — every node is full detail.
 *
 * Parity (DESIGN §1): clicking the card opens the SAME editor the table row /
 * kanban card opens, via `data.onSelectItem`. Phase is changed inline through a
 * {@link PhaseSelect} pill (full parity with the table's inline phase edit) →
 * `data.onUpdateItem(id, { phase })`; in Phase mode a lane drop is the other
 * phase gesture (handled by the view on drag-stop). The node carries a source
 * Handle and a target Handle so an edge-drag between two nodes creates a
 * dependency (the view's `onConnect`).
 *
 * Read-only (DESIGN §5): when the view has no mutators it passes
 * `connectable: false` and omits `onUpdateItem`; the Handles disable and the
 * phase pill falls back to a read-only {@link PhasePill}. Node draggability is
 * gated by the view (`nodesDraggable`), mirroring the Kanban `draggable` gate.
 *
 * Wrapped in {@link React.memo} (DESIGN §3): the node re-renders only when ITS
 * `data` changes, not on every viewport pan/zoom — the central React Flow
 * performance lever. `nodeTypes` is defined at module level in the view so this
 * component is never recreated per render.
 */
export interface WorkItemNodeData {
  /** The row this node renders; carries derived `health` + roll-up counts. */
  readonly row: WorkItemRow;
  /** Owner lookup for the node's owner chip — resolves `assignee_id`. */
  readonly owners: ReadonlyArray<Owner>;
  /** Whether the connection Handles are live (false in read-only mode). */
  readonly connectable: boolean;
  /** Card activation → the view opens the editor Sheet with this item. */
  readonly onSelectItem: (item: WorkItemRow) => void;
  /**
   * Optional inline mutator (absent in read-only mode). When present, the phase
   * pill is an editable {@link PhaseSelect}; otherwise a read-only pill.
   */
  readonly onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<unknown>;
  // Index signature so the shape satisfies React Flow's `Record`-based node-data
  // constraint without weakening the explicit fields above.
  readonly [key: string]: unknown;
}

/** Max tags shown on a node before the `+N` overflow chip (mirrors Kanban). */
const NODE_TAG_MAX = 3;

/** Em-dash placeholder for an empty read-only field (parity with Kanban). */
const EMPTY = "—";

/**
 * Format an ISO-8601 `due_date` for the node's read-only due field. Slices the
 * date portion (locale-stable for CI/tests); `null` → em-dash. Mirrors the
 * table's / Kanban's `formatDue` so the three views read identically.
 */
function formatDue(due: string | null): string {
  if (due === null) return EMPTY;
  return due.slice(0, 10);
}

/**
 * Derive an owner's 1–2 char initials for the avatar fallback. Prefers the
 * explicit `initials`; otherwise takes the first letter of up to two name words.
 * Mirrors the Kanban card's `ownerInitials`.
 */
function ownerInitials(owner: Owner): string {
  if (owner.initials) return owner.initials;
  return owner.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/** Read-only owner chip: avatar + initials, or a muted "Unassigned". */
function NodeOwner({
  row,
  owners,
}: Readonly<{ row: WorkItemRow; owners: ReadonlyArray<Owner> }>) {
  const owner = owners.find((candidate) => candidate.id === row.assignee_id);
  if (!owner) {
    return <span className="text-xs text-muted-foreground">Unassigned</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar size="sm">
        <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-xs text-muted-foreground">{owner.name}</span>
    </span>
  );
}

/**
 * The graph node body (un-memoized inner). Exported separately only so the view
 * never has to reach into the memoized wrapper; callers use {@link WorkItemNode}.
 */
function WorkItemNodeBody({ data }: NodeProps) {
  // React Flow types node data as a generic record; narrow to our shape.
  const { row, owners, connectable, onSelectItem, onUpdateItem } =
    data as unknown as WorkItemNodeData;

  const isArchived = row.archived === true;

  const handleOpen = React.useCallback(() => {
    onSelectItem(row);
  }, [onSelectItem, row]);

  const handlePhaseChange = React.useCallback(
    (next: Phase) => {
      if (next === row.phase) return;
      // Fire-and-forget: the hook rolls back optimistic state on rejection, so a
      // failed change simply never appears in the next render (DESIGN §5).
      onUpdateItem?.(row.id, { phase: next }).catch(() => undefined);
    },
    [onUpdateItem, row.id, row.phase],
  );

  return (
    <div
      data-testid="graph-node"
      data-item-id={row.id}
      data-archived={isArchived ? "true" : undefined}
      className={cn(
        "flex w-[240px] flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left text-card-foreground shadow-sm",
        "transition-shadow hover:shadow-md",
        isArchived && "text-muted-foreground opacity-60",
      )}
    >
      {/* Target Handle (left): an incoming edge ends here. Source → target means
          "source depends on target", so the arrow points INTO the prerequisite. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={connectable}
        data-testid="graph-handle-target"
      />

      {/* Title opens the editor (parity). A real <button> so keyboard activation
          (Enter/Space) works without a custom keydown handler. */}
      <button
        type="button"
        data-testid="graph-node-open"
        aria-label={`Open ${row.title}`}
        onClick={handleOpen}
        className={cn(
          "truncate text-left text-sm font-medium text-foreground hover:underline",
          "focus-visible:outline-2 focus-visible:outline-ring",
        )}
      >
        {row.title}
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        {onUpdateItem ? (
          <PhaseSelect
            size="sm"
            value={row.phase}
            aria-label={`Phase for ${row.title}`}
            onValueChange={handlePhaseChange}
          />
        ) : (
          <PhasePill phase={row.phase} />
        )}
        <HealthBadge health={row.health} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <WorkItemTypeBadge type={row.type} />
        <PriorityBadge priority={row.priority} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <NodeOwner row={row} owners={owners} />
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDue(row.due_date)}
        </span>
      </div>

      {row.tags.length > 0 ? <TagList tags={row.tags} max={NODE_TAG_MAX} /> : null}

      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <ProvenanceChip source={row.source} />
          </TooltipTrigger>
          <TooltipContent>Source: {row.source}</TooltipContent>
        </Tooltip>
        {isArchived ? (
          <span
            data-testid="graph-archived-indicator"
            className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium"
          >
            Archived
          </span>
        ) : null}
      </div>

      {/* Source Handle (right): an outgoing edge starts here — drag from here to
          another node's target Handle to create a dependency (view's onConnect). */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={connectable}
        data-testid="graph-handle-source"
      />
    </div>
  );
}

/**
 * Memoized graph node (DESIGN §3 performance lever). Re-renders only when its
 * `data` reference changes — never on viewport pan/zoom.
 */
export const WorkItemNode = React.memo(WorkItemNodeBody);
WorkItemNode.displayName = "WorkItemNode";
