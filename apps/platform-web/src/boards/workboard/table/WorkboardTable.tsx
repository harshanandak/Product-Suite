import * as React from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import {
  AssigneePicker,
  Button,
  Checkbox,
  PHASE_LABELS,
  PRIORITY_LABELS,
  PhasePill,
  PhaseSelect,
  PriorityBadge,
  PrioritySelect,
  ProvenanceChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagInput,
  TagList,
  WORK_ITEM_TYPE_LABELS,
  WorkItemTypeBadge,
  WorkItemTypeSelect,
  cn,
} from "@product-suite/ui";

import {
  COLUMN_IDS,
  type ColumnId,
  type GroupByField,
} from "@/boards/workboard/filter-state";
import type {
  Owner,
  WorkItem,
  WorkItemPatch,
  WorkItemRow,
} from "@/data/work-items";

/**
 * Workboard TABLE view (DESIGN §2 / §4 / §5).
 *
 * Renders {@link WorkItemRow}s — which already carry derived `health` and task
 * roll-up counts from the data seam — as a virtualized, accessible grid deepened
 * to the wireframe (`plan-table`) column set: a structural selection checkbox
 * plus Name · Type · Phase · Priority · Owner · Due · Tags · Source. Which data
 * columns show (and their order) is driven entirely by {@link ColumnId} /
 * `visibleColumns`; rows are grouped into swimlanes by any {@link GroupByField}.
 *
 * Cell behaviour (DESIGN §5 — controls are ALWAYS shared `@product-suite/ui`
 * primitives, never bare `<select>`/`<input>`/`<button role>`):
 *  - Name — a `<button>` that opens the editor (selection ⇄ row-open parity).
 *  - Type/Phase/Priority/Owner/Tags — inline-editable via their `*Select` /
 *    `AssigneePicker` / `TagInput` primitives when a mutator is wired; each falls
 *    back to its read-only badge/pill/list otherwise.
 *  - Due — read-only formatted date (there is intentionally NO date-picker
 *    primitive; `due_date` is edited only in the editor).
 *  - Source — read-only {@link ProvenanceChip} (provenance is display-only).
 *
 * Because virtualization overrides each element's `display` (flex/block/absolute)
 * — which strips the native `<table>`'s implicit ARIA roles — every structural
 * element re-declares an explicit role (`table`/`rowgroup`/`row`/`columnheader`/
 * `gridcell`) plus `aria-rowcount`/`aria-colcount`/`aria-colindex`, so assistive
 * tech still announces a real table with column headers.
 *
 * This component is presentational: the parent owns the data (`rows` arrive via
 * props, already searched + filtered) and the mutator (`onUpdateItem`). It never
 * calls `useWorkItems` itself and never filters `rows`, so it can never desync
 * from what the parent renders. Selection is fully CONTROLLED (`selection` +
 * `onSelectionChange`) so the toolbar and table share one selection set.
 */
export interface WorkItemTableProps {
  /**
   * Rows already searched + filtered by the parent, each carrying derived
   * `health`, `taskCount`, `completedTaskCount`. Render `HealthBadge` / read-only
   * badges from the row; never re-derive here (DESIGN §3 — health is computed
   * once, on read). The table does NOT filter — it renders exactly these rows.
   */
  rows: WorkItemRow[];
  /** Owner lookup for the Owner column — resolves `assignee_id` → name/picker. */
  owners: ReadonlyArray<Owner>;
  /** Render skeletons mirroring the final layout during the initial load. */
  loading: boolean;
  /** Set on load failure; renders an ErrorState with a retry path. */
  error: Error | null;
  /** Wired to `hook.refetch`; used by the error state's retry button. */
  onRetry?: () => void;
  /** Current swimlane grouping; `"none"` renders a flat list. */
  groupBy: GroupByField;
  /** Which data columns are shown; rendered in {@link COLUMN_IDS} order. */
  visibleColumns: ReadonlySet<ColumnId>;
  /** Selected work-item ids (CONTROLLED — the table owns no selection state). */
  selection: ReadonlySet<string>;
  /** Fired with the next selection set on a checkbox toggle. */
  onSelectionChange: (next: Set<string>) => void;
  /** Row title activation → parent opens the editor Sheet with this item. */
  onSelectItem: (item: WorkItemRow) => void;
  /**
   * Optional inline mutator mirroring `hook.update`. When omitted, all editable
   * cells fall back to their read-only display — so read-only embeds still
   * type-check and behave. (Bulk actions live in the toolbar, not the table.)
   */
  onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}

/** Estimated row height (px) for the virtualizer; rows are single-line. */
const ROW_HEIGHT = 48;
/** Extra rows rendered above/below the viewport to smooth fast scrolling. */
const OVERSCAN = 8;
/** Width (rem) of the always-present leading selection column. */
const SELECT_COLUMN_WIDTH = "2.5rem";

/** Stable keys for the fixed-count loading skeleton placeholders. */
const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

/** Em-dash placeholder for empty read-only cells. */
const EMPTY = "—";

/**
 * Format an ISO-8601 `due_date` for the read-only Due column. Slices the date
 * portion of the ISO string rather than `toLocaleDateString` so the rendered
 * text is locale-stable (CI / test determinism); `null` → em-dash.
 */
function formatDue(due: string | null): string {
  if (due === null) return EMPTY;
  // ISO-8601 → `YYYY-MM-DD` (the substring before `T`); fall back to the raw
  // value if it is not in the expected shape.
  return due.slice(0, 10);
}

/**
 * A single data column's contract. One registry entry drives the header text,
 * width, and BOTH render paths (editable when a mutator is present, read-only
 * otherwise). Filtering {@link COLUMN_IDS} through `visibleColumns` yields the
 * shown columns in canonical order — no positional width array to keep in sync.
 */
interface ColumnSpec {
  readonly id: ColumnId;
  readonly header: string;
  /** Fixed width; `"auto"` flexes to fill (the Name column). */
  readonly width: string;
  readonly render: (ctx: ColumnRenderContext) => React.ReactNode;
}

interface ColumnRenderContext {
  readonly row: WorkItemRow;
  readonly owners: ReadonlyArray<Owner>;
  readonly onSelectItem: (item: WorkItemRow) => void;
  readonly onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}

/**
 * Fire-and-forget patch helper: applies a single-field patch only when the value
 * actually changed. The hook rolls back optimistic state on rejection, so the
 * failed value simply never appears in the next `rows` render — nothing to do in
 * the catch beyond swallowing the rejection.
 */
function commitPatch(
  ctx: ColumnRenderContext,
  patch: WorkItemPatch,
): void {
  ctx.onUpdateItem?.(ctx.row.id, patch).catch(() => undefined);
}

/** The canonical column registry, in {@link COLUMN_IDS} order. */
const COLUMN_SPECS: readonly ColumnSpec[] = [
  {
    id: "name",
    header: "Name",
    width: "auto",
    render: ({ row, onSelectItem }) => (
      <button
        type="button"
        className={cn(
          "truncate text-left font-medium text-foreground hover:underline",
          "focus-visible:outline-2 focus-visible:outline-ring",
        )}
        onClick={() => {
          onSelectItem(row);
        }}
      >
        {row.title}
      </button>
    ),
  },
  {
    id: "type",
    header: "Type",
    width: "9rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <WorkItemTypeSelect
          size="sm"
          value={row.type}
          aria-label={`Type for ${row.title}`}
          onValueChange={(next) =>
            commitPatch({ row, onUpdateItem, ...rest }, { type: next })
          }
        />
      ) : (
        <WorkItemTypeBadge type={row.type} />
      ),
  },
  {
    id: "phase",
    header: "Phase",
    width: "9rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <PhaseSelect
          size="sm"
          value={row.phase}
          aria-label={`Phase for ${row.title}`}
          onValueChange={(next) =>
            commitPatch({ row, onUpdateItem, ...rest }, { phase: next })
          }
        />
      ) : (
        <PhasePill phase={row.phase} />
      ),
  },
  {
    id: "priority",
    header: "Priority",
    width: "9rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <PrioritySelect
          size="sm"
          value={row.priority}
          aria-label={`Priority for ${row.title}`}
          onValueChange={(next) =>
            commitPatch({ row, onUpdateItem, ...rest }, { priority: next })
          }
        />
      ) : (
        <PriorityBadge priority={row.priority} />
      ),
  },
  {
    id: "owner",
    header: "Owner",
    width: "12rem",
    render: ({ row, owners, onUpdateItem, ...rest }) => {
      if (onUpdateItem) {
        return (
          <AssigneePicker
            size="sm"
            value={row.assignee_id}
            assignees={owners}
            aria-label={`Owner for ${row.title}`}
            onValueChange={(next) =>
              commitPatch(
                { row, owners, onUpdateItem, ...rest },
                { assignee_id: next },
              )
            }
          />
        );
      }
      const owner = owners.find((candidate) => candidate.id === row.assignee_id);
      return (
        <span className="text-muted-foreground">
          {owner ? owner.name : "Unassigned"}
        </span>
      );
    },
  },
  {
    id: "due",
    header: "Due",
    width: "8rem",
    render: ({ row }) => (
      <span className="text-muted-foreground">{formatDue(row.due_date)}</span>
    ),
  },
  {
    id: "tags",
    header: "Tags",
    width: "14rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <TagInput
          value={row.tags}
          aria-label={`Tags for ${row.title}`}
          onValueChange={(next) =>
            commitPatch({ row, onUpdateItem, ...rest }, { tags: next })
          }
        />
      ) : (
        <TagList tags={row.tags} max={3} />
      ),
  },
  {
    id: "source",
    header: "Source",
    width: "9rem",
    render: ({ row }) => <ProvenanceChip source={row.source} />,
  },
];

const COLUMN_SPEC_BY_ID: Record<ColumnId, ColumnSpec> = Object.fromEntries(
  COLUMN_SPECS.map((spec) => [spec.id, spec]),
) as Record<ColumnId, ColumnSpec>;

/** The visible columns, in canonical {@link COLUMN_IDS} order. */
function visibleColumnSpecs(
  visibleColumns: ReadonlySet<ColumnId>,
): ColumnSpec[] {
  return COLUMN_IDS.filter((id) => visibleColumns.has(id)).map(
    (id) => COLUMN_SPEC_BY_ID[id],
  );
}

/** Human-readable swimlane header text for a row under the active grouping. */
function groupLabelFor(row: WorkItemRow, groupBy: GroupByField): string {
  switch (groupBy) {
    case "phase":
      return PHASE_LABELS[row.phase];
    case "priority":
      return PRIORITY_LABELS[row.priority];
    case "type":
      return WORK_ITEM_TYPE_LABELS[row.type];
    case "department":
    case "none":
    default:
      return row.department;
  }
}

/**
 * One flattened display unit fed to the virtualizer: either a swimlane header or
 * a leaf work-item row. Virtualizing a single flat list (rather than nested
 * sections) keeps measurement correct under react-virtual.
 */
type FlatRow =
  | { kind: "group"; label: string; count: number; key: string }
  | { kind: "item"; row: WorkItemRow; key: string };

/**
 * Flatten `rows` into the virtualized list. When `groupBy === "none"` this is a
 * flat list of item rows; otherwise rows are bucketed by their group label
 * (preserving first-seen order) with a header row per bucket.
 */
function flattenRows(rows: WorkItemRow[], groupBy: GroupByField): FlatRow[] {
  if (groupBy === "none") {
    return rows.map((row) => ({ kind: "item", row, key: `item:${row.id}` }));
  }

  const order: string[] = [];
  const buckets = new Map<string, WorkItemRow[]>();
  for (const row of rows) {
    const label = groupLabelFor(row, groupBy);
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(label, [row]);
      order.push(label);
    }
  }

  const flat: FlatRow[] = [];
  for (const label of order) {
    const items = buckets.get(label) ?? [];
    flat.push({
      kind: "group",
      label,
      count: items.length,
      key: `group:${label}`,
    });
    for (const row of items) {
      flat.push({ kind: "item", row, key: `item:${row.id}` });
    }
  }
  return flat;
}

function LoadingSkeleton() {
  return (
    <div
      data-testid="workboard-table-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="w-full space-y-2"
    >
      <span className="sr-only">Loading work items…</span>
      {SKELETON_KEYS.map((key) => (
        <div
          key={key}
          aria-hidden="true"
          className="h-12 w-full animate-pulse rounded-md bg-muted"
        />
      ))}
    </div>
  );
}

function ErrorPanel({ onRetry }: Readonly<{ onRetry?: () => void }>) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center"
    >
      <p className="text-sm font-medium text-foreground">
        Could not load work items
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Style for a header/body cell of the given width (flex layout, see jsdoc). */
function cellStyle(width: string): React.CSSProperties {
  return width === "auto"
    ? { flex: "1 1 auto" }
    : { width, flex: "0 0 auto" };
}

/**
 * Workboard table — virtualized, grouped, inline-editable view over work items.
 *
 * @see WorkItemTableProps for the prop contract.
 */
export function WorkboardTable({
  rows,
  owners,
  loading,
  error,
  onRetry,
  groupBy,
  visibleColumns,
  selection,
  onSelectionChange,
  onSelectItem,
  onUpdateItem,
}: Readonly<WorkItemTableProps>) {
  const columns = React.useMemo(
    () => visibleColumnSpecs(visibleColumns),
    [visibleColumns],
  );

  const itemIds = React.useMemo(
    () => new Set(rows.map((row) => row.id)),
    [rows],
  );

  const flatRows = React.useMemo(
    () => flattenRows(rows, groupBy),
    [rows, groupBy],
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const allSelected = rows.length > 0 && selection.size === rows.length;
  const someSelected = selection.size > 0 && !allSelected;
  /** Tri-state for the select-all header: minus glyph when partial. */
  let selectAllState: boolean | "indeterminate" = false;
  if (allSelected) {
    selectAllState = true;
  } else if (someSelected) {
    selectAllState = "indeterminate";
  }

  const toggleAll = React.useCallback(() => {
    onSelectionChange(
      selection.size === itemIds.size ? new Set() : new Set(itemIds),
    );
  }, [itemIds, onSelectionChange, selection.size]);

  const toggleOne = React.useCallback(
    (id: string) => {
      const next = new Set(selection);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(next);
    },
    [onSelectionChange, selection],
  );

  if (loading) {
    return <LoadingSkeleton />;
  }
  if (error) {
    return <ErrorPanel onRetry={onRetry} />;
  }

  // 1-based row count for assistive tech: header row + every flat (group/item)
  // row in the virtualized list, regardless of which are currently mounted.
  const ariaRowCount = flatRows.length + 1;
  // Selection column + every visible data column.
  const ariaColCount = 1 + columns.length;

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={scrollRef}
        role="table"
        aria-label="Work items"
        aria-rowcount={ariaRowCount}
        aria-colcount={ariaColCount}
        className="relative max-h-[75vh] overflow-auto rounded-lg border"
      >
        <Table>
          <TableHeader role="rowgroup" className="sticky top-0 z-10 bg-background">
            <TableRow role="row" aria-rowindex={1} className="flex w-full">
              <TableHead
                role="columnheader"
                aria-colindex={1}
                style={cellStyle(SELECT_COLUMN_WIDTH)}
              >
                <Checkbox
                  aria-label="Select all work items"
                  checked={selectAllState}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              {columns.map((column, columnIndex) => (
                <TableHead
                  key={column.id}
                  role="columnheader"
                  aria-colindex={columnIndex + 2}
                  style={cellStyle(column.width)}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody
            role="rowgroup"
            style={{
              display: "block",
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const flat = flatRows[virtualRow.index];
              const offsetStyle: React.CSSProperties = {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
                display: "flex",
              };
              // +2: skip the 1-based header row at index 1.
              const ariaRowIndex = virtualRow.index + 2;

              if (flat.kind === "group") {
                return (
                  <TableRow
                    key={flat.key}
                    role="row"
                    aria-rowindex={ariaRowIndex}
                    aria-label={`${flat.label}, ${flat.count} items`}
                    data-testid="swimlane-group"
                    data-group={flat.label}
                    className="bg-muted/40"
                    style={offsetStyle}
                  >
                    <TableCell
                      role="cell"
                      aria-colindex={1}
                      className="flex-1 font-medium"
                    >
                      {flat.label}{" "}
                      <span className="text-muted-foreground">
                        ({flat.count})
                      </span>
                    </TableCell>
                  </TableRow>
                );
              }

              const { row } = flat;
              const isSelected = selection.has(row.id);
              return (
                <TableRow
                  key={flat.key}
                  role="row"
                  aria-rowindex={ariaRowIndex}
                  aria-selected={isSelected}
                  data-testid="work-item-row"
                  data-state={isSelected ? "selected" : undefined}
                  style={offsetStyle}
                >
                  <TableCell
                    role="gridcell"
                    aria-colindex={1}
                    style={cellStyle(SELECT_COLUMN_WIDTH)}
                  >
                    <Checkbox
                      aria-label={`Select ${row.title}`}
                      checked={isSelected}
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      onCheckedChange={() => {
                        toggleOne(row.id);
                      }}
                    />
                  </TableCell>
                  {columns.map((column, columnIndex) => (
                    <TableCell
                      key={column.id}
                      role="gridcell"
                      aria-colindex={columnIndex + 2}
                      className={column.width === "auto" ? "overflow-hidden" : undefined}
                      style={cellStyle(column.width)}
                    >
                      {column.render({
                        row,
                        owners,
                        onSelectItem,
                        onUpdateItem,
                      })}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
