import * as React from "react";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  Button,
  Checkbox,
  HealthBadge,
  PhasePill,
  PhaseSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@product-suite/ui";

import type {
  Phase,
  WorkItem,
  WorkItemPatch,
  WorkItemRow,
} from "@/data/work-items";

/**
 * Workboard TABLE view (DESIGN §2 / §4 / §5).
 *
 * Renders {@link WorkItemRow}s — which already carry derived `health` and task
 * roll-up counts from the data seam — as a virtualized, accessible grid. Rows
 * are grouped into department swimlanes. Phase is inline-editable per row and in
 * bulk across a selection; both flow through the same {@link WorkItemPatch}
 * surface the editor and repository use.
 *
 * Because virtualization overrides each element's `display` (flex/block/absolute)
 * — which strips the native `<table>`'s implicit ARIA roles — every structural
 * element re-declares an explicit role (`table`/`rowgroup`/`row`/`columnheader`/
 * `cell`) plus `aria-rowcount`/`aria-colindex`, so assistive tech still
 * announces a real table with column headers.
 *
 * This component is presentational: the parent owns the data (`items` arrive via
 * props) and the mutator (`onUpdateItem`). It never calls `useWorkItems` itself,
 * so it can never desync from the `items` the parent renders.
 */
export interface WorkItemTableProps {
  /**
   * Rows already carrying derived `health`, `taskCount`, `completedTaskCount`.
   * Render `HealthBadge` from `row.health` and `PhasePill` from `row.phase`;
   * never re-derive here (DESIGN §3 — health is computed once, on read).
   */
  items: WorkItemRow[];
  /** Render skeletons mirroring the final layout during the initial load. */
  loading: boolean;
  /** Set on load failure; renders an ErrorState with a retry path. */
  error: Error | null;
  /** Wired to `hook.refetch`; used by the error state's retry button. */
  onRetry?: () => void;
  /** Row activation → parent opens the editor Sheet with this item. */
  onSelectItem: (item: WorkItemRow) => void;
  /**
   * DEVIATION (documented): the verbatim `WorkItemTableProps` in the brief has
   * five props and no mutator, yet the task requires inline + bulk phase edits
   * that "call the hook's update mutator". Calling `useWorkItems` internally
   * would create a second data source that desyncs from the `items` prop, so
   * the mutator is surfaced as a callback prop mirroring `hook.update` exactly.
   * Optional so read-only embeds (and the existing five-prop contract) still
   * type-check; the inline/bulk controls are inert when it is omitted.
   */
  onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}

/** Estimated row height (px) for the virtualizer; rows are single-line. */
const ROW_HEIGHT = 48;
/** Extra rows rendered above/below the viewport to smooth fast scrolling. */
const OVERSCAN = 8;

/**
 * Total columns the grid exposes to assistive tech: the leading select column
 * plus the four data columns (title, phase, health, department). Drives
 * `aria-colcount` on the table and the 1-based `aria-colindex` on each cell.
 */
const TOTAL_COLUMNS = 5;

const columnHelper = createColumnHelper<WorkItemRow>();

/** Stable keys for the fixed-count loading skeleton placeholders. */
const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

/**
 * Explicit per-column widths. Because the virtualized body rows are rendered as
 * absolutely-positioned `display:table; table-layout:fixed` elements detached
 * from the `<thead>`'s layout context, header and body cannot agree on widths
 * by auto-layout. Applying the SAME width to each header cell and its matching
 * body cell keeps the columns aligned. Order: [select, title, phase, health,
 * department].
 */
const COLUMN_WIDTHS = ["2.5rem", "auto", "12rem", "8rem", "10rem"] as const;

/**
 * One flattened display unit fed to the virtualizer: either a department
 * swimlane header or a leaf work-item row. Virtualizing a single flat list
 * (rather than nested sections) keeps measurement correct under react-virtual.
 */
type FlatRow =
  | { kind: "group"; department: string; count: number; key: string }
  | { kind: "item"; row: WorkItemRow; key: string };

/** Group rows by `department` (swimlanes), preserving first-seen order. */
function groupByDepartment(rows: WorkItemRow[]): FlatRow[] {
  const order: string[] = [];
  const buckets = new Map<string, WorkItemRow[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.department);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(row.department, [row]);
      order.push(row.department);
    }
  }

  const flat: FlatRow[] = [];
  for (const department of order) {
    const items = buckets.get(department) ?? [];
    flat.push({
      kind: "group",
      department,
      count: items.length,
      key: `group:${department}`,
    });
    for (const row of items) {
      flat.push({ kind: "item", row, key: `item:${row.id}` });
    }
  }
  return flat;
}

/**
 * Inline phase editor: the shared, fully keyboard-accessible {@link PhaseSelect}
 * (DESIGN §5 — never a bare `<select>`). The row exposes no row-level click
 * handler (selection flows through the title `<button>` only), so the editor
 * needs no propagation guard. When no mutator is wired, falls back to a
 * read-only `PhasePill`.
 */
function PhaseEditCell({
  row,
  onUpdateItem,
}: Readonly<{
  row: WorkItemRow;
  onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}>) {
  if (!onUpdateItem) {
    return <PhasePill phase={row.phase} />;
  }
  return (
    <span className="inline-flex items-center">
      <PhaseSelect
        size="sm"
        value={row.phase}
        aria-label={`Phase for ${row.title}`}
        onValueChange={(next) => {
          if (next !== row.phase) {
            void onUpdateItem(row.id, { phase: next }).catch(() => {
              // The hook rolls back optimistic state on rejection; the failed
              // value simply will not appear in the next `items` render.
            });
          }
        }}
      />
    </span>
  );
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

/**
 * Workboard table — virtualized, grouped, inline-editable view over work items.
 *
 * @see WorkItemTableProps for the (deviation-documented) prop contract.
 */
export function WorkboardTable({
  items,
  loading,
  error,
  onRetry,
  onSelectItem,
  onUpdateItem,
}: Readonly<WorkItemTableProps>) {
  const [selection, setSelection] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [bulkPhase, setBulkPhase] = React.useState<Phase>("plan");

  // Prune selection if the underlying items change (e.g. realtime refetch).
  const itemIds = React.useMemo(
    () => new Set(items.map((item) => item.id)),
    [items],
  );
  React.useEffect(() => {
    setSelection((current) => {
      const next = new Set<string>();
      for (const id of current) {
        if (itemIds.has(id)) next.add(id);
      }
      return next.size === current.size ? current : next;
    });
  }, [itemIds]);

  const columns = React.useMemo<ColumnDef<WorkItemRow, unknown>[]>(
    () => [
      columnHelper.accessor("title", { header: "Title" }) as ColumnDef<
        WorkItemRow,
        unknown
      >,
      columnHelper.accessor("phase", { header: "Phase" }) as ColumnDef<
        WorkItemRow,
        unknown
      >,
      columnHelper.accessor("health", { header: "Health" }) as ColumnDef<
        WorkItemRow,
        unknown
      >,
      columnHelper.accessor("department", { header: "Department" }) as ColumnDef<
        WorkItemRow,
        unknown
      >,
    ],
    [],
  );

  // react-table drives the column model; rendering is custom (grouped + virtual).
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const headerGroups = table.getHeaderGroups();

  const flatRows = React.useMemo(() => groupByDepartment(items), [items]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const allSelected = items.length > 0 && selection.size === items.length;
  const someSelected = selection.size > 0 && !allSelected;
  /** Tri-state for the select-all header: minus glyph when partial. */
  let selectAllState: boolean | "indeterminate" = false;
  if (allSelected) {
    selectAllState = true;
  } else if (someSelected) {
    selectAllState = "indeterminate";
  }

  const toggleAll = React.useCallback(() => {
    setSelection((current) =>
      current.size === itemIds.size ? new Set() : new Set(itemIds),
    );
  }, [itemIds]);

  const toggleOne = React.useCallback((id: string) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const applyBulkPhase = React.useCallback(() => {
    if (!onUpdateItem || selection.size === 0) return;
    const ids = [...selection];
    void Promise.all(
      ids.map((id) =>
        onUpdateItem(id, { phase: bulkPhase }).catch(() => undefined),
      ),
    ).finally(() => {
      setSelection(new Set());
    });
  }, [onUpdateItem, selection, bulkPhase]);

  if (loading) {
    return <LoadingSkeleton />;
  }
  if (error) {
    return <ErrorPanel onRetry={onRetry} />;
  }

  const canBulk = Boolean(onUpdateItem) && selection.size > 0;
  // 1-based row count for assistive tech: header row + every flat (group/item)
  // row in the virtualized list, regardless of which are currently mounted.
  const ariaRowCount = flatRows.length + 1;

  return (
    <div className="flex flex-col gap-3">
      {Boolean(onUpdateItem) && (
        <div
          className="flex items-center gap-2"
          role="toolbar"
          aria-label="Bulk actions"
        >
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {selection.size} selected
          </span>
          <label className="sr-only" htmlFor="bulk-phase">
            Bulk phase
          </label>
          <PhaseSelect
            id="bulk-phase"
            size="sm"
            aria-label="Bulk phase"
            value={bulkPhase}
            disabled={!canBulk}
            onValueChange={setBulkPhase}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!canBulk}
            onClick={applyBulkPhase}
          >
            Apply phase
          </Button>
        </div>
      )}

      <div
        ref={scrollRef}
        role="table"
        aria-label="Work items"
        aria-rowcount={ariaRowCount}
        aria-colcount={TOTAL_COLUMNS}
        className="relative max-h-[75vh] overflow-auto rounded-lg border"
      >
        <Table>
          <TableHeader role="rowgroup" className="sticky top-0 z-10 bg-background">
            {headerGroups.map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                role="row"
                aria-rowindex={1}
                className="flex w-full"
              >
                <TableHead
                  role="columnheader"
                  aria-colindex={1}
                  style={{ width: COLUMN_WIDTHS[0], flex: "0 0 auto" }}
                >
                  {Boolean(onUpdateItem) && (
                    <Checkbox
                      aria-label="Select all work items"
                      checked={selectAllState}
                      onCheckedChange={toggleAll}
                    />
                  )}
                </TableHead>
                {headerGroup.headers.map((header, headerIndex) => {
                  const width = COLUMN_WIDTHS[headerIndex + 1];
                  return (
                    <TableHead
                      key={header.id}
                      role="columnheader"
                      aria-colindex={headerIndex + 2}
                      style={{
                        width: width === "auto" ? undefined : width,
                        flex: width === "auto" ? "1 1 auto" : "0 0 auto",
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
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
                    aria-label={`${flat.department} department, ${flat.count} items`}
                    data-testid="department-group"
                    data-department={flat.department}
                    className="bg-muted/40"
                    style={offsetStyle}
                  >
                    <TableCell
                      role="cell"
                      aria-colindex={1}
                      className="flex-1 font-medium"
                    >
                      {flat.department}{" "}
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
                  aria-selected={onUpdateItem ? isSelected : undefined}
                  data-testid="work-item-row"
                  data-state={isSelected ? "selected" : undefined}
                  style={offsetStyle}
                >
                  <TableCell
                    role="gridcell"
                    aria-colindex={1}
                    style={{ width: COLUMN_WIDTHS[0], flex: "0 0 auto" }}
                  >
                    {Boolean(onUpdateItem) && (
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
                    )}
                  </TableCell>
                  <TableCell
                    role="gridcell"
                    aria-colindex={2}
                    className="overflow-hidden"
                    style={{ flex: "1 1 auto" }}
                  >
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
                  </TableCell>
                  <TableCell
                    role="gridcell"
                    aria-colindex={3}
                    style={{ width: COLUMN_WIDTHS[2], flex: "0 0 auto" }}
                  >
                    <PhaseEditCell row={row} onUpdateItem={onUpdateItem} />
                  </TableCell>
                  <TableCell
                    role="gridcell"
                    aria-colindex={4}
                    style={{ width: COLUMN_WIDTHS[3], flex: "0 0 auto" }}
                  >
                    <HealthBadge health={row.health} />
                  </TableCell>
                  <TableCell
                    role="gridcell"
                    aria-colindex={5}
                    className="text-muted-foreground"
                    style={{ width: COLUMN_WIDTHS[4], flex: "0 0 auto" }}
                  >
                    {row.department}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
