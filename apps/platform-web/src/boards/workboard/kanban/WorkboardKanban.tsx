import * as React from "react";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  Avatar,
  AvatarFallback,
  EmptyState,
  ErrorState,
  HealthBadge,
  PHASE_LABELS,
  type Phase,
  PriorityBadge,
  ProvenanceChip,
  TagList,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkItemTypeBadge,
  Button,
  cn,
} from "@product-suite/ui";

import type {
  Owner,
  WorkItem,
  WorkItemPatch,
  WorkItemRow,
} from "@/data/work-items";

/**
 * Workboard KANBAN view (DESIGN §5 board grammar).
 *
 * Renders {@link WorkItemRow}s — which already carry derived `health` and task
 * roll-up counts from the data seam — as a phase-column board. The columns ARE
 * the universal phase loop (`plan → execute → review → done`); dragging a card
 * to another column changes its `phase`. Health rides each card as a
 * {@link HealthBadge}, never as a column — health is derived, not a lifecycle
 * stage, so it must never become a board axis (§3 / §5).
 *
 * This component is presentational: the parent owns the data (`rows` arrive via
 * props, already searched + filtered) and the mutator (`onUpdateItem`). It never
 * calls `useWorkItems` itself and never filters `rows`, mirroring the table so
 * the two views can never desync. Card activation has full parity with the
 * table row: clicking a card opens the editor via `onSelectItem`.
 *
 * Drag vs. click: a {@link PointerSensor} activation DISTANCE constraint means a
 * plain click never starts a drag, so the card's `onClick` (→ `onSelectItem`)
 * and a real drag (→ phase change) stay cleanly separate. A
 * {@link KeyboardSensor} makes the board fully operable without a mouse.
 *
 * When `onUpdateItem` is absent the board is READ-ONLY: drag is disabled and
 * cards are not draggable, but every read-only display still renders.
 */
export interface WorkboardKanbanProps {
  /**
   * Rows already searched + filtered by the parent, each carrying derived
   * `health`, `taskCount`, `completedTaskCount`. Render badges from the row;
   * never re-derive here (DESIGN §3 — health is computed once, on read). The
   * board does NOT filter — it renders exactly these rows, grouped by phase.
   */
  rows: WorkItemRow[];
  /** Owner lookup for the card owner — resolves `assignee_id` → name/initials. */
  owners: ReadonlyArray<Owner>;
  /** Render skeleton columns mirroring the final layout during the initial load. */
  loading: boolean;
  /** Set on load failure; renders an ErrorState with a retry path. */
  error: Error | null;
  /** Wired to `hook.refetch`; used by the error state's retry button. */
  onRetry?: () => void;
  /** Card activation → parent opens the editor Sheet with this item. */
  onSelectItem: (item: WorkItemRow) => void;
  /**
   * Optional drag mutator mirroring `hook.update`. When omitted, the board is
   * read-only (drag disabled). On a cross-column drop it is called with the
   * dragged id and `{ phase }`; the hook rolls back optimistic state on failure.
   */
  onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}

/**
 * The phase columns, in the canonical phase-loop order (§1). Single source for
 * the column set and their order — never re-list phases inline.
 */
const PHASE_COLUMNS: readonly Phase[] = ["plan", "execute", "review", "done"];

/** Max tags shown on a card before the `+N` overflow chip (mirrors the table). */
const CARD_TAG_MAX = 3;

/** Em-dash placeholder for an empty read-only card field. */
const EMPTY = "—";

/** Min pointer travel (px) before a drag begins, so a click is never a drag. */
const DRAG_ACTIVATION_DISTANCE = 6;

/** Stable keys for the fixed-count loading skeleton cards per column. */
const SKELETON_CARD_KEYS = ["c1", "c2"] as const;

/**
 * Format an ISO-8601 `due_date` for the read-only due field. Slices the date
 * portion of the ISO string (locale-stable for CI/tests); `null` → em-dash.
 * Mirrors the table's `formatDue` so the two views read identically.
 */
function formatDue(due: string | null): string {
  if (due === null) return EMPTY;
  return due.slice(0, 10);
}

/**
 * Derive an owner's 1–2 char initials for the avatar fallback. Prefers the
 * explicit `initials`; otherwise takes the first letter of up to two name words.
 */
function ownerInitials(owner: Owner): string {
  if (owner.initials) return owner.initials;
  return owner.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/**
 * Pure drag→phase resolution (extracted for unit testing). Given the phase the
 * dragged card currently sits in and the column it was dropped on, return the
 * NEW phase to commit — or `null` when nothing should change.
 *
 * Returns `null` when:
 *  - there is no valid drop target (`overId` is null/unknown), or
 *  - the target column is the card's current phase (a same-column drop is a
 *    no-op — never fire a redundant patch).
 *
 * @param fromPhase - the dragged card's current phase.
 * @param overId - the droppable id under the pointer at drop (a phase, or null).
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure drag→phase helper, exported only for unit tests
export function resolvePhaseChange(
  fromPhase: Phase,
  overId: string | null,
): Phase | null {
  if (overId === null) return null;
  if (!PHASE_COLUMNS.includes(overId as Phase)) return null;
  const toPhase = overId as Phase;
  return toPhase === fromPhase ? null : toPhase;
}

/** Group rows into phase buckets, preserving incoming order within a column. */
function groupByPhase(rows: WorkItemRow[]): Record<Phase, WorkItemRow[]> {
  const buckets: Record<Phase, WorkItemRow[]> = {
    plan: [],
    execute: [],
    review: [],
    done: [],
  };
  for (const row of rows) {
    buckets[row.phase].push(row);
  }
  return buckets;
}

interface OwnerCellProps {
  readonly row: WorkItemRow;
  readonly owners: ReadonlyArray<Owner>;
}

/** Read-only owner chip: avatar + initials, or a muted "Unassigned". */
function CardOwner({ row, owners }: OwnerCellProps) {
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

interface KanbanCardProps {
  readonly row: WorkItemRow;
  readonly owners: ReadonlyArray<Owner>;
  readonly draggable: boolean;
  readonly onSelectItem: (item: WorkItemRow) => void;
}

/**
 * A single work-item card. Renders the read-only field set with shared UI
 * primitives (type/priority/health badges, owner avatar, due, tags, provenance)
 * and opens the editor on click. When `draggable`, wires the dnd-kit draggable
 * handle so a real drag (distance-gated) changes the card's phase.
 */
function KanbanCard({ row, owners, draggable, onSelectItem }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: row.id, disabled: !draggable });

  const isArchived = row.archived === true;

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    // Lift the dragged card above its siblings while it travels.
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="kanban-card"
      data-archived={isArchived ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`Open ${row.title}`}
      onClick={() => {
        onSelectItem(row);
      }}
      onKeyDown={(event) => {
        // Enter/Space activate "open" (drag uses arrow keys via the sensor).
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectItem(row);
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left text-card-foreground shadow-sm",
        "transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring",
        isDragging && "opacity-80 shadow-lg",
        isArchived && "text-muted-foreground opacity-60",
      )}
    >
      <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <WorkItemTypeBadge type={row.type} />
        <PriorityBadge priority={row.priority} />
        <HealthBadge health={row.health} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <CardOwner row={row} owners={owners} />
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDue(row.due_date)}
        </span>
      </div>
      {row.tags.length > 0 ? <TagList tags={row.tags} max={CARD_TAG_MAX} /> : null}
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <ProvenanceChip source={row.source} />
          </TooltipTrigger>
          <TooltipContent>Source: {row.source}</TooltipContent>
        </Tooltip>
        {isArchived ? (
          <span
            data-testid="kanban-archived-indicator"
            className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium"
          >
            Archived
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface KanbanColumnProps {
  readonly phase: Phase;
  readonly rows: WorkItemRow[];
  readonly owners: ReadonlyArray<Owner>;
  readonly draggable: boolean;
  readonly onSelectItem: (item: WorkItemRow) => void;
}

/**
 * A single phase column: a droppable region with a header (label + count badge)
 * and its cards. An empty column shows a muted "No items" placeholder so the
 * drop target stays discoverable.
 */
function KanbanColumn({
  phase,
  rows,
  owners,
  draggable,
  onSelectItem,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: phase, disabled: !draggable });
  const label = PHASE_LABELS[phase];

  return (
    <section
      ref={setNodeRef}
      data-testid="kanban-column"
      data-phase={phase}
      data-over={isOver ? "true" : undefined}
      // `group`/`region` semantics: AT announces the column as a labelled group.
      role="group"
      aria-label={`${label}, ${rows.length} items`}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3",
        isOver && "ring-2 ring-ring",
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <span
          data-testid="kanban-column-count"
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {rows.length}
        </span>
      </header>
      <div className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <p
            data-testid="kanban-column-empty"
            className="rounded-md border border-dashed border-border px-2 py-6 text-center text-xs text-muted-foreground"
          >
            No items
          </p>
        ) : (
          rows.map((row) => (
            <KanbanCard
              key={row.id}
              row={row}
              owners={owners}
              draggable={draggable}
              onSelectItem={onSelectItem}
            />
          ))
        )}
      </div>
    </section>
  );
}

/** Loading state: one skeleton column per phase, each with placeholder cards. */
function LoadingSkeleton() {
  return (
    <div
      data-testid="workboard-kanban-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <span className="sr-only">Loading work items…</span>
      {PHASE_COLUMNS.map((phase) => (
        <div
          key={phase}
          aria-hidden="true"
          className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
        >
          <div className="h-5 w-20 animate-pulse rounded bg-muted" />
          {SKELETON_CARD_KEYS.map((cardKey) => (
            <div
              key={cardKey}
              className="h-24 w-full animate-pulse rounded-md bg-muted"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Workboard kanban — a phase-column drag-and-drop board over work items.
 *
 * @see WorkboardKanbanProps for the prop contract.
 */
export function WorkboardKanban({
  rows,
  owners,
  loading,
  error,
  onRetry,
  onSelectItem,
  onUpdateItem,
}: Readonly<WorkboardKanbanProps>) {
  const draggable = onUpdateItem !== undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A click is not a drag: require deliberate travel before activating.
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const columns = React.useMemo(() => groupByPhase(rows), [rows]);

  const phaseById = React.useMemo(() => {
    const map = new Map<string, Phase>();
    for (const row of rows) map.set(row.id, row.phase);
    return map;
  }, [rows]);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      if (!onUpdateItem) return;
      const cardId = String(event.active.id);
      const fromPhase = phaseById.get(cardId);
      if (fromPhase === undefined) return;
      const overId = event.over ? String(event.over.id) : null;
      const nextPhase = resolvePhaseChange(fromPhase, overId);
      if (nextPhase === null) return;
      // Fire-and-forget: the hook rolls back optimistic state on rejection, so
      // a failed drop simply never appears in the next `rows` render.
      onUpdateItem(cardId, { phase: nextPhase }).catch(() => undefined);
    },
    [onUpdateItem, phaseById],
  );

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

  const board = (
    <div
      data-testid="workboard-kanban"
      role="list"
      aria-label="Work items by phase"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {PHASE_COLUMNS.map((phase) => (
        <div key={phase} role="listitem">
          <KanbanColumn
            phase={phase}
            rows={columns[phase]}
            owners={owners}
            draggable={draggable}
            onSelectItem={onSelectItem}
          />
        </div>
      ))}
    </div>
  );

  return (
    <TooltipProvider>
      {rows.length === 0 ? (
        <EmptyState
          title="No work items"
          description="Nothing matches the current filters yet."
        />
      ) : draggable ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {board}
        </DndContext>
      ) : (
        board
      )}
    </TooltipProvider>
  );
}
