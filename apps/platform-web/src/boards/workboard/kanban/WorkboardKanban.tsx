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
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  type Priority,
  ProvenanceChip,
  TagList,
  WorkItemTypeBadge,
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
  type WorkItemType,
  Button,
  cn,
} from "@product-suite/ui";

import type {
  Owner,
  WorkItem,
  WorkItemPatch,
  WorkItemRow,
} from "@/data/work-items";

import { type GroupByField, workboardTeams } from "../filter-state";

/**
 * Workboard KANBAN view (DESIGN §5 board grammar).
 *
 * Renders {@link WorkItemRow}s — which already carry derived `health` and check
 * roll-up counts from the data seam — as a configurable group-by board. The
 * board re-pivots on the toolbar's "Group by" control ({@link GroupByField}):
 * `phase` (the universal loop `plan → execute → review → done`), `priority`,
 * `type`, or `team`; `none` falls back to phase (a board needs columns).
 * Dragging a card to another column patches the GROUPED field — phase on a phase
 * board, priority on a priority board, and so on — never always phase. Health
 * rides each card as a {@link HealthBadge}, never as a column — health is
 * derived, not a lifecycle stage, so it must never become a board axis (§3 §5).
 *
 * This component is presentational: the parent owns the data (`rows` arrive via
 * props, already searched + filtered) and the mutator (`onUpdateItem`). It never
 * calls `useWorkItems` itself and never filters `rows`, mirroring the table so
 * the two views can never desync. Card activation has full parity with the
 * table row: clicking a card opens the editor via `onSelectItem`.
 *
 * Drag vs. click: a {@link PointerSensor} activation DISTANCE constraint means a
 * plain click never starts a drag, so the card's `onClick` (→ `onSelectItem`)
 * and a real drag (→ grouped-field change) stay cleanly separate. A
 * {@link KeyboardSensor} makes the board fully operable without a mouse.
 *
 * When `onUpdateItem` is absent the board is READ-ONLY: drag is disabled and
 * cards are not draggable, but every read-only display still renders.
 */
export interface WorkboardKanbanProps {
  /**
   * Rows already searched + filtered by the parent, each carrying derived
   * `health`, `checkCount`, `completedCheckCount`. Render badges from the row;
   * never re-derive here (DESIGN §3 — health is computed once, on read). The
   * board does NOT filter — it renders exactly these rows, grouped by `groupBy`.
   */
  rows: WorkItemRow[];
  /**
   * The dimension the columns pivot on (the toolbar's shared "Group by" value).
   * `phase` | `priority` | `type` render a fixed, fully-ordered column set;
   * `team` renders the teams PRESENT plus an "Unassigned" bucket;
   * `none` falls back to a phase board. Defaults to `phase` so a standalone or
   * read-only board still has columns. The dragged-to column patches THIS field.
   */
  groupBy?: GroupByField;
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
   * dragged id and a patch on the GROUPED field (`{ [groupBy]: value }` — e.g.
   * `{ priority }` on a priority board); the hook rolls back optimistic state on
   * failure.
   */
  onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}

/**
 * The four fields a board can pivot on. Excludes `none` (a non-axis) — see
 * {@link boardFieldOf}, which folds `none` into `phase`. Every member is a key of
 * {@link WorkItemPatch}, so a dropped column can always patch its own field.
 */
export type BoardField = "phase" | "priority" | "type" | "team";

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

/** Human label for the board axis, used in the board's `aria-label`. */
const BOARD_FIELD_LABELS: Record<BoardField, string> = {
  phase: "phase",
  priority: "priority",
  type: "type",
  team: "team",
};

/**
 * The grouped value of a row with no team — its column is labelled
 * "Unassigned" and trails the named teams. The underlying `department`
 * (deprecated team-name carrier) is a non-null `string` in the model, so
 * "no team" is the empty string.
 */
const UNASSIGNED_DEPARTMENT = "";
const UNASSIGNED_LABEL = "Unassigned";

/**
 * Fold the toolbar's {@link GroupByField} into a concrete board axis. `none` is
 * not a real axis (a board needs columns), so it falls back to `phase`; every
 * other value already names a {@link BoardField}.
 */
function boardFieldOf(groupBy: GroupByField): BoardField {
  return groupBy === "none" ? "phase" : groupBy;
}

/** The grouping value a row contributes on the given axis (its column key). */
function rowValue(row: WorkItemRow, field: BoardField): string {
  switch (field) {
    case "phase":
      return row.phase;
    case "priority":
      return row.priority;
    case "type":
      return row.type;
    case "team":
      // Reads `row.department` — the deprecated-but-retained team-name carrier.
      return row.department;
  }
}

/**
 * Encode a column's droppable id as `field:value`. Encoding the FIELD makes ids
 * unambiguous across the dnd id space: a column value can never collide with a
 * card id (`wi_*`) or with another axis's value. Exported for the drag tests.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure id codec, exported only for unit tests
export function encodeColumnId(field: BoardField, value: string): string {
  return `${field}:${value}`;
}

/**
 * Decode an {@link encodeColumnId} id back to `{ field, value }`, or `null` when
 * the id is malformed / names no known field. Splits on the FIRST `:` only, so a
 * value containing a colon (e.g. a team name) round-trips intact.
 */
function decodeColumnId(
  id: string,
): { field: BoardField; value: string } | null {
  const separator = id.indexOf(":");
  if (separator === -1) return null;
  const field = id.slice(0, separator);
  if (
    field !== "phase" &&
    field !== "priority" &&
    field !== "type" &&
    field !== "team"
  ) {
    return null;
  }
  return { field, value: id.slice(separator + 1) };
}

/**
 * Build the field-scoped {@link WorkItemPatch} for a dropped value. The `switch`
 * is exhaustive over {@link BoardField} — every arm narrows to that field's enum
 * — so it doubles as the patchability guard: only the four patchable keys can be
 * constructed, and a non-axis field could never reach here.
 */
function patchFor(field: BoardField, value: string): WorkItemPatch {
  switch (field) {
    case "phase":
      return { phase: value as Phase };
    case "priority":
      return { priority: value as Priority };
    case "type":
      return { type: value as WorkItemType };
    case "team":
      // The `team` axis writes the `department` data field (contracts accept it
      // for back-compat; the `team_id` write path is a Phase-4 dependency).
      return { department: value };
  }
}

/**
 * Pure drag→patch resolution for ANY axis (extracted for unit testing). Given
 * the dragged card's current value on `field` and the droppable id it was
 * dropped on, return the {@link WorkItemPatch} to commit — or `null` when
 * nothing should change.
 *
 * Returns `null` when:
 *  - there is no drop target (`overId` is null), or the id is unknown, or
 *  - the id encodes a DIFFERENT field (a stray cross-axis id — never patch), or
 *  - the target column equals the card's current value (a no-op drop).
 *
 * @param field - the board's current axis.
 * @param fromValue - the dragged card's current value on that axis.
 * @param overId - the encoded droppable id under the pointer at drop, or null.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure drag→patch helper, exported only for unit tests
export function resolveDrop(
  field: BoardField,
  fromValue: string,
  overId: string | null,
): WorkItemPatch | null {
  if (overId === null) return null;
  const target = decodeColumnId(overId);
  if (target === null || target.field !== field) return null;
  if (target.value === fromValue) return null;
  return patchFor(field, target.value);
}

/** One rendered board column: its droppable id, grouped value, label, rows. */
interface BoardColumn {
  readonly id: string;
  readonly value: string;
  readonly label: string;
  readonly rows: WorkItemRow[];
}

/**
 * Build the ordered columns for `field`, bucketing `rows` (incoming order
 * preserved within a column). Enum axes (`phase` / `priority` / `type`) render
 * EVERY column in canonical order even when empty; `team` renders only the
 * teams present (sorted via {@link workboardTeams}) plus a trailing
 * "Unassigned" bucket when any row has no team.
 */
function buildColumns(rows: WorkItemRow[], field: BoardField): BoardColumn[] {
  const buckets = new Map<string, WorkItemRow[]>();
  for (const row of rows) {
    const value = rowValue(row, field);
    const bucket = buckets.get(value);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(value, [row]);
    }
  }

  const column = (value: string, label: string): BoardColumn => ({
    id: encodeColumnId(field, value),
    value,
    label,
    rows: buckets.get(value) ?? [],
  });

  switch (field) {
    case "phase":
      return PHASE_COLUMNS.map((phase) => column(phase, PHASE_LABELS[phase]));
    case "priority":
      return PRIORITY_ORDER.map((priority) =>
        column(priority, PRIORITY_LABELS[priority]),
      );
    case "type":
      return WORK_ITEM_TYPE_ORDER.map((type) =>
        column(type, WORK_ITEM_TYPE_LABELS[type]),
      );
    case "team": {
      const named = workboardTeams(rows)
        .filter((team) => team !== UNASSIGNED_DEPARTMENT)
        .map((team) => column(team, team));
      // A trailing Unassigned bucket only when something actually lands in it.
      if (buckets.has(UNASSIGNED_DEPARTMENT)) {
        named.push(column(UNASSIGNED_DEPARTMENT, UNASSIGNED_LABEL));
      }
      return named;
    }
  }
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

  // The card is a clickable + draggable element that cannot be a native <button>:
  // it nests an interactive descendant (the provenance tooltip trigger), which a
  // <button> may not contain. It therefore carries an explicit button role + full
  // tab/keyboard/mouse/touch support. SonarCloud S6819 ("prefer <button>") is a
  // known false positive here — dismiss it via "Mark as False Positive" in the
  // SonarCloud UI (Automatic Analysis cannot suppress a rule on a file via config).
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
        {/* The shared ProvenanceChip already renders its source label as visible
            text, so it needs no tooltip to surface the source. */}
        <ProvenanceChip source={row.source} />
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
  readonly field: BoardField;
  readonly value: string;
  readonly label: string;
  readonly rows: WorkItemRow[];
  readonly owners: ReadonlyArray<Owner>;
  readonly draggable: boolean;
  readonly onSelectItem: (item: WorkItemRow) => void;
}

/**
 * A single board column: a droppable region with a header (label + count badge)
 * and its cards. The droppable id encodes the axis ({@link encodeColumnId}) so
 * drops resolve to the grouped field. An empty column shows a muted "No items"
 * placeholder so the drop target stays discoverable.
 */
function KanbanColumn({
  field,
  value,
  label,
  rows,
  owners,
  draggable,
  onSelectItem,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: encodeColumnId(field, value),
    disabled: !draggable,
  });

  return (
    <section
      ref={setNodeRef}
      data-testid="kanban-column"
      data-column-field={field}
      data-column-value={value}
      // Keep the legacy `data-phase` hook on a phase board (tests + tooling read
      // it); other axes expose their value via `data-column-value` only.
      data-phase={field === "phase" ? value : undefined}
      data-over={isOver ? "true" : undefined}
      // A labelled <section> is a region landmark announcing this column to AT
      // (the implicit region role carries the name — no explicit role needed).
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
  groupBy = "phase",
}: Readonly<WorkboardKanbanProps>) {
  const draggable = onUpdateItem !== undefined;
  const field = boardFieldOf(groupBy);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A click is not a drag: require deliberate travel before activating.
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const columns = React.useMemo(
    () => buildColumns(rows, field),
    [rows, field],
  );

  // Each card's current value on the active axis — the drag's `from`, so a
  // same-column drop is a cheap no-op without re-reading the row.
  const valueById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.id, rowValue(row, field));
    return map;
  }, [rows, field]);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      if (!onUpdateItem) return;
      const cardId = String(event.active.id);
      const fromValue = valueById.get(cardId);
      if (fromValue === undefined) return;
      const overId = event.over ? String(event.over.id) : null;
      const patch = resolveDrop(field, fromValue, overId);
      if (patch === null) return;
      // Fire-and-forget: the hook rolls back optimistic state on rejection, so
      // a failed drop simply never appears in the next `rows` render.
      onUpdateItem(cardId, patch).catch(() => undefined);
    },
    [onUpdateItem, valueById, field],
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
    <ul
      data-testid="workboard-kanban"
      aria-label={`Work items by ${BOARD_FIELD_LABELS[field]}`}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {columns.map((column) => (
        <li key={column.id}>
          <KanbanColumn
            field={field}
            value={column.value}
            label={column.label}
            rows={column.rows}
            owners={owners}
            draggable={draggable}
            onSelectItem={onSelectItem}
          />
        </li>
      ))}
    </ul>
  );

  // A draggable board is wrapped in the dnd context; a read-only board renders
  // bare. Resolved up-front so the JSX below stays a single (non-nested) ternary.
  const content = draggable ? (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {board}
    </DndContext>
  ) : (
    board
  );

  return rows.length === 0 ? (
    <EmptyState
      title="No work items"
      description="Nothing matches the current filters yet."
    />
  ) : (
    content
  );
}
