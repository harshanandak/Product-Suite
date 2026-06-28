import * as React from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, MoreHorizontal } from "lucide-react";

import {
  AssigneePicker,
  Avatar,
  AvatarFallback,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorState,
  PHASE_LABELS,
  PRIORITY_LABELS,
  PhasePill,
  PhaseSelect,
  PriorityBadge,
  PrioritySelect,
  ProvenanceChip,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TagInput,
  TagList,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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

import { MAX_COLUMN_WIDTH, useColumnWidths } from "./useColumnWidths";

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
 * element re-declares an explicit role. The container is a `grid`
 * (`aria-multiselectable` — rows carry `aria-selected`) rather than a plain
 * `table`, over `rowgroup`/`row`/`columnheader`/`cell` plus `aria-rowcount`/
 * `aria-colcount`/`aria-colindex`, so assistive tech announces a real,
 * selectable grid with column headers.
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
  /**
   * Optional ref the parent reads to trigger a GLOBAL column-width reset (the
   * toolbar's "Reset column widths" item). The table publishes its hook's
   * `reset` into `ref.current`; the parent invokes it without owning the state.
   */
  resetColumnWidthsRef?: { current: (() => void) | null };
}

/**
 * Row height (px) for the virtualizer; rows are single-line. Tightened for the
 * compact Notion density: the tallest cell content is an `h-8` (32px) inline
 * control, and the data cells use `py-1.5` (2×6px) → 32 + 12 = 44, so a row
 * never exceeds this slot and overlaps its virtualized neighbour.
 */
const ROW_HEIGHT = 44;
/** Extra rows rendered above/below the viewport to smooth fast scrolling. */
const OVERSCAN = 8;
/** Width (rem) of the always-present leading selection column. */
const SELECT_COLUMN_WIDTH = "2.5rem";
/** The same selection column width in px, for the `--table-width` total. */
const SELECT_COLUMN_WIDTH_PX = 40;
/** The trailing actions column width in px (3rem), for the `--table-width` total. */
const ACTIONS_COLUMN_WIDTH_PX = 48;

/** Stable keys for the fixed-count loading skeleton placeholders. */
const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

/** Em-dash placeholder for empty read-only cells. */
const EMPTY = "—";

/** Month abbreviations for the compact Due display, indexed 0 = Jan. */
const DUE_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format an ISO-8601 `due_date` for the read-only Due column as a compact
 * "Mon D" label (e.g. `2026-07-10` → "Jul 10"). Parses the ISO date parts by
 * hand rather than `toLocaleDateString` so the rendered text is locale-stable
 * (CI / test determinism); `null` → em-dash, and any unexpected shape falls back
 * to the sliced ISO date.
 */
function formatDue(due: string | null): string {
  if (due === null) return EMPTY;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (match === null) return due.slice(0, 10);
  const month = DUE_MONTHS[Number(match[2]) - 1];
  if (month === undefined) return due.slice(0, 10);
  return `${month} ${Number(match[3])}`;
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
  /**
   * Column width. For a content-sized (fixed) column this is the exact width.
   * For a flexible column (`grow` set) it is the flex-basis the column starts
   * from before growing into spare space.
   */
  readonly width: string;
  /**
   * When set, the column flexes: `flex: <grow> 1 <width>`. The weight controls
   * how aggressively it claims spare space relative to other flexible columns
   * (Name uses 2, Tags 1, so Name grows twice as fast). Fixed columns omit this
   * and never grow or shrink (`flex: 0 0 auto`).
   */
  readonly grow?: number;
  /**
   * Hard floor for a flexible column so it can never collapse (the Name column's
   * raison d'être). Defaults to `width` when omitted.
   */
  readonly minWidth?: string;
  /** When true, the header and cell are right-aligned (numeric/date columns). */
  readonly alignRight?: boolean;
  readonly render: (ctx: ColumnRenderContext) => React.ReactNode;
}

interface ColumnRenderContext {
  readonly row: WorkItemRow;
  readonly owners: ReadonlyArray<Owner>;
  readonly onSelectItem: (item: WorkItemRow) => void;
  readonly onUpdateItem?: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
  /**
   * Whether the row is archived. Only the Name column reads it — to strike
   * through + mute the title as a non-contrast archived cue (the row no longer
   * dims wholesale, so status badges keep full opacity).
   */
  readonly archived?: boolean;
}

/** Up-to-2-char initials for the read-only Owner avatar (mirrors the picker). */
function ownerInitials(owner: Owner): string {
  if (owner.initials) return owner.initials;
  return owner.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
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

/**
 * Inline (ghost) select cells reveal their dropdown chevron on ROW hover/focus so
 * an editable cell is discoverable — without the chevron stealing layout width at
 * rest (that was the "Feature" → "Fe" clipping when it reserved ~24px in flow).
 *
 * The fix is to take the chevron OUT of flow: it is absolutely positioned at the
 * trigger's right edge, so the badge value keeps the full cell at rest. The ghost
 * `SelectTrigger` variant already supplies the rest state (`[&>svg]:opacity-0` +
 * `transition-opacity`) and keeps the chevron visible on the trigger's OWN
 * hover/focus/open; here we only add the absolute positioning plus a `group-*`
 * reveal so it also fades in when the whole row (the `group`) is hovered/focused.
 */
const INLINE_SELECT_CLASS = cn(
  // Anchor the absolutely-positioned chevron to the trigger.
  "relative",
  // Pin the chevron at the trigger's right edge — out of flow, so it reserves
  // NO width and the badge value reads full-width at rest (only overlays on hover).
  "[&>svg]:absolute [&>svg]:top-1/2 [&>svg]:right-2 [&>svg]:-translate-y-1/2",
  // Fade it in on ROW hover / focus-within so the cell is discoverable as editable.
  "group-hover:[&>svg]:opacity-50 group-focus-within:[&>svg]:opacity-50",
);

/** Inline Tags summary: chips shown at rest before the rest collapse to `+N`. */
const TAGS_SUMMARY_MAX = 3;

/**
 * Inline-editable Tags cell.
 *
 * The naive "always render the full {@link TagInput}" approach squeezed the
 * field's `flex-1` text input to ~zero on populated rows and clipped overflow
 * chips with NO signal. Instead this reads at rest as a compact, single-line
 * {@link TagList} summary — the first {@link TAGS_SUMMARY_MAX} chips PLUS a `+N`
 * overflow chip (so hidden tags are always signalled, never silently clipped) —
 * and only expands into the full editable `TagInput` when the cell is clicked or
 * focused. On expand the text input is focused so typing starts immediately; when
 * focus leaves the WHOLE cell (not when it merely moves to a chip's ✕ remove
 * control — the `contains` guard below) it collapses back to the summary. The
 * cell never wraps to a second line, so the row stays within `ROW_HEIGHT`.
 */
function TagsCell({
  row,
  onCommit,
}: Readonly<{
  row: WorkItemRow;
  onCommit: (tags: string[]) => void;
}>) {
  const [editing, setEditing] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  // On expand, move focus into the text input so the user can type at once. The
  // TagInput renders exactly one <input>; focusing it directly avoids an
  // `autoFocus` prop (and its jsx-a11y lint) on the shared primitive.
  React.useEffect(() => {
    if (editing) wrapperRef.current?.querySelector("input")?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Edit tags for ${row.title}`}
        onClick={() => setEditing(true)}
        onFocus={() => setEditing(true)}
        className={cn(
          "flex w-full min-w-0 items-center overflow-hidden rounded-md py-0.5 text-left",
          "hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring",
        )}
      >
        {row.tags.length > 0 ? (
          <TagList
            tags={row.tags}
            max={TAGS_SUMMARY_MAX}
            className="flex-nowrap overflow-hidden"
          />
        ) : (
          <span className="truncate px-1 text-xs text-muted-foreground">
            Add tags…
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      ref={wrapperRef}
      onBlur={(event) => {
        // Collapse only when focus leaves the WHOLE cell — not when it moves to
        // an inner control (e.g. a chip's ✕), which would drop edit mode mid-click.
        const root = wrapperRef.current;
        if (root === null || !root.contains(event.relatedTarget)) {
          setEditing(false);
        }
      }}
    >
      <TagInput
        value={row.tags}
        variant="ghost"
        aria-label={`Tags for ${row.title}`}
        // Single-line in the cell: chips never wrap to a second row (which would
        // exceed ROW_HEIGHT and overlap the virtualized neighbour); overflow is
        // clipped, the editor shows the full set.
        className="w-full flex-nowrap overflow-hidden"
        onValueChange={onCommit}
      />
    </div>
  );
}

/**
 * The canonical column registry, in {@link COLUMN_IDS} order.
 *
 * Sizing model: the table is a flex grid, so columns are sized by explicit
 * widths, not content. Name is the PRIMARY column — flexible with a 16rem floor
 * so it grows to fill spare space yet NEVER collapses; Tags is a secondary
 * flexible column. Each fixed column is wide enough for its LONGEST label once
 * the inline chevron is dropped (Type fits "Research", Phase "Execute", Priority
 * "Critical"), so values read in full at rest. The screen is full-width, so spare
 * space flows to Name/Tags; narrower viewports scroll horizontally (fixed columns
 * hold, Name/Tags shrink only to their floors) — Name is always legible.
 */
const COLUMN_SPECS: readonly ColumnSpec[] = [
  {
    id: "name",
    header: "Name",
    width: "16rem",
    grow: 2,
    minWidth: "16rem",
    render: ({ row, onSelectItem, archived }) => (
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          className={cn(
            "truncate text-left font-medium hover:underline",
            "focus-visible:outline-2 focus-visible:outline-ring",
            // Archived: strike + mute the title as a non-contrast cue (no row-
            // wide opacity dim, so the status badges stay full strength).
            archived
              ? "text-muted-foreground line-through"
              : "text-foreground",
          )}
          onClick={() => {
            onSelectItem(row);
          }}
        >
          {row.title}
        </button>
        {/* Copy-on-hover: progressive disclosure, revealed on row hover/focus. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Copy title"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard?.writeText(row.title);
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy title</TooltipContent>
        </Tooltip>
      </div>
    ),
  },
  {
    id: "type",
    header: "Type",
    width: "8.5rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <WorkItemTypeSelect
          size="sm"
          variant="ghost"
          className={INLINE_SELECT_CLASS}
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
    width: "7.5rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <PhaseSelect
          size="sm"
          variant="ghost"
          className={INLINE_SELECT_CLASS}
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
    width: "8rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <PrioritySelect
          size="sm"
          variant="ghost"
          className={INLINE_SELECT_CLASS}
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
    width: "11rem",
    render: ({ row, owners, onUpdateItem, ...rest }) => {
      if (onUpdateItem) {
        return (
          <AssigneePicker
            size="sm"
            variant="ghost"
            // Drop AssigneePicker's intrinsic `min-w-40` (160px) floor: it would
            // overflow the cell's content box (minus the p-2 cell padding) and
            // spill into Due. `min-w-0` lets the w-full ghost trigger fill the
            // cell; long names truncate via the value clamp. The shared inline
            // class keeps the chevron out of flow (revealed on row hover) so the
            // avatar+name read full-width at rest.
            className={cn("min-w-0", INLINE_SELECT_CLASS)}
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
      if (!owner) {
        // No resolvable owner: plain muted text, clipped so it can't bleed into
        // the Due column. (Kept as bare text so the empty-owners path reads
        // "Unassigned".)
        return (
          <span className="block truncate text-muted-foreground">
            Unassigned
          </span>
        );
      }
      // Mirror the edit state's avatar+name, clipped to the cell so a long name
      // truncates here instead of spilling into Due.
      return (
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Avatar size="sm" className="shrink-0">
            <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
          </Avatar>
          <span className="block min-w-0 truncate">{owner.name}</span>
        </span>
      );
    },
  },
  {
    // Left-aligned (header + cell): a right-aligned narrow column opened a wide
    // whitespace "river" between Owner and the date; left-aligning closes it.
    id: "due",
    header: "Due",
    width: "5rem",
    render: ({ row }) => (
      <span className="block truncate text-left text-muted-foreground">
        {formatDue(row.due_date)}
      </span>
    ),
  },
  {
    id: "tags",
    header: "Tags",
    width: "10rem",
    grow: 1,
    minWidth: "8rem",
    render: ({ row, onUpdateItem, ...rest }) =>
      onUpdateItem ? (
        <TagsCell
          row={row}
          onCommit={(next) =>
            commitPatch({ row, onUpdateItem, ...rest }, { tags: next })
          }
        />
      ) : (
        <TagList tags={row.tags} max={TAGS_SUMMARY_MAX} />
      ),
  },
  {
    id: "source",
    header: "Source",
    width: "6.5rem",
    // Tooltip surfaces the source name behind the otherwise icon-only chip.
    render: ({ row }) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <ProvenanceChip source={row.source} />
        </TooltipTrigger>
        <TooltipContent>Source: {row.source}</TooltipContent>
      </Tooltip>
    ),
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
    // `groupBy === "none"` never reaches here — flattenRows short-circuits on it
    // before any label is computed — so "department" is the only remaining case.
    case "department":
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

/** Fixed-width cell style (selection + actions columns never flex). */
function cellStyle(width: string): React.CSSProperties {
  return { width, flex: "0 0 auto" };
}

/**
 * Header/body cell style for a DATA column. Every data column is now a resizable
 * fixed px width carried by the `--col-<id>` CSS custom property on the scroll
 * container, so the header and every body cell read the SAME live var (`flex:
 * 0 0 var(--col-<id>)`) and a drag repaints by mutating the var — no re-render.
 */
function dataColumnStyle(id: ColumnId): React.CSSProperties {
  return { width: `var(--col-${id})`, flex: `0 0 var(--col-${id})` };
}

/** Style applied to the header row, every body row, and the swimlane group row:
 * span the full table width, but never shy of the viewport so the hairlines
 * reach the right edge when Σ widths < viewport (correction 1). */
const ROW_SPAN_STYLE: React.CSSProperties = {
  width: "var(--table-width)",
  minWidth: "100%",
};

/** Width (rem) of the trailing row-actions column (only when a mutator wires). */
const ACTIONS_COLUMN_WIDTH = "3rem";

/**
 * Trailing per-row "⋯" actions menu (progressive disclosure). The trigger stays
 * invisible until the row is hovered OR the button receives keyboard focus, then
 * opens a {@link DropdownMenu} of row-scoped actions. Only rendered when a
 * mutator is wired (Open/Copy ID always make sense, but Archive needs the patch
 * path), so read-only embeds keep their hardcoded column counts.
 *
 * Both the trigger and the menu content `stopPropagation` so interacting with
 * the menu never bubbles up to open the row editor.
 */
function RowActionsCell({
  row,
  onSelectItem,
  onUpdateItem,
}: Readonly<{
  row: WorkItemRow;
  onSelectItem: (item: WorkItemRow) => void;
  onUpdateItem: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
}>) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${row.title}`}
              className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            onSelectItem(row);
          }}
        >
          Open
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard?.writeText(row.id);
          }}
        >
          Copy ID
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onUpdateItem(row.id, { archived: !row.archived }).catch(
              () => undefined,
            );
          }}
        >
          {row.archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  resetColumnWidthsRef,
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

  // The trailing "⋯" actions cell only renders when a mutator is wired (its
  // Archive action needs the patch path); read-only embeds keep their existing
  // column counts. Computed here (not after the early returns) so the resizable-
  // width total can include the actions column.
  const showActions = onUpdateItem !== undefined;

  // Resizable px column widths exposed as `--col-<id>` / `--table-width` vars on
  // the scroll container. `extraWidth` folds in the fixed selection + actions
  // columns so the row span var covers the whole row.
  const colWidths = useColumnWidths(
    columns,
    SELECT_COLUMN_WIDTH_PX + (showActions ? ACTIONS_COLUMN_WIDTH_PX : 0),
  );
  const { containerRef, reset: resetWidths } = colWidths;

  // Publish the hook's reset so the toolbar's "Reset column widths" (threaded
  // through the screen) can fire it without owning the width state.
  React.useEffect(() => {
    const ref = resetColumnWidthsRef;
    if (ref === undefined) return undefined;
    ref.current = resetWidths;
    return () => {
      ref.current = null;
    };
  }, [resetColumnWidthsRef, resetWidths]);

  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  // Derive select-all state from VISIBLE membership, not raw set size: a filter
  // change can leave ids in `selection` that no longer map to a visible row, so
  // size-equality would falsely read "all selected" and drive bulk on hidden
  // rows. Counting how many visible rows are selected keeps the header honest.
  const visibleSelected = rows.filter((row) => selection.has(row.id)).length;
  const allSelected = rows.length > 0 && visibleSelected === rows.length;
  const someSelected = visibleSelected > 0 && !allSelected;
  /** Tri-state for the select-all header: minus glyph when partial. */
  let selectAllState: boolean | "indeterminate" = false;
  if (allSelected) {
    selectAllState = true;
  } else if (someSelected) {
    selectAllState = "indeterminate";
  }

  const toggleAll = React.useCallback(() => {
    const next = new Set(selection);
    if (allSelected) {
      // Clear: remove exactly the visible ids, preserving any off-screen ones.
      for (const id of itemIds) next.delete(id);
    } else {
      // Select: add every visible id, preserving any off-screen selection.
      for (const id of itemIds) next.add(id);
    }
    onSelectionChange(next);
  }, [allSelected, itemIds, onSelectionChange, selection]);

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

  // Range-selection anchor: the ID of the last PLAINLY-toggled row. Stored by id
  // (not a raw index) so it survives a filter / sort / regroup — the index is
  // re-resolved against the CURRENT flatRows at shift-click time and can never
  // point at a different item than the one the user anchored.
  const anchorIdRef = React.useRef<string | null>(null);
  // The Checkbox's `onCheckedChange` carries no event, so the modifier is read
  // off the preceding `onClick` (Radix composes our handler before its own, so
  // this is set before `onCheckedChange` fires) and stashed here for the toggle.
  const shiftKeyRef = React.useRef(false);

  // Checkbox activation by flat-row index. A plain click toggles the one row and
  // moves the anchor; a shift-click selects the INCLUSIVE range between the live
  // anchor (re-resolved by id against the current flatRows) and the clicked row
  // in flatRows order (group-header rows are skipped), unioning into the current
  // selection. A shift-click whose anchor is gone (filtered out) or unset falls
  // back to a single toggle.
  const handleRowSelect = React.useCallback(
    (index: number) => {
      const flat = flatRows[index];
      if (flat === undefined || flat.kind !== "item") return;

      const anchorId = anchorIdRef.current;
      const anchor =
        shiftKeyRef.current && anchorId !== null
          ? flatRows.findIndex(
              (candidate) =>
                candidate.kind === "item" && candidate.row.id === anchorId,
            )
          : -1;

      if (anchor >= 0) {
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const next = new Set(selection);
        for (let i = start; i <= end; i += 1) {
          const candidate = flatRows[i];
          if (candidate?.kind === "item") next.add(candidate.row.id);
        }
        onSelectionChange(next);
        return;
      }

      toggleOne(flat.row.id);
      anchorIdRef.current = flat.row.id;
    },
    [flatRows, onSelectionChange, selection, toggleOne],
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

  // 1-based row count for assistive tech: header row + every flat (group/item)
  // row in the virtualized list, regardless of which are currently mounted.
  const ariaRowCount = flatRows.length + 1;
  // Selection column + every visible data column (+ the actions column, if shown).
  const ariaColCount = 1 + columns.length + (showActions ? 1 : 0);

  return (
    <TooltipProvider>
    <div className="flex flex-col gap-3">
      {/* Flat / borderless chrome (Notion-style): no outer card frame. Rows are
          separated only by the primitives' hairline `border-b` and a light
          hover highlight; the sticky header carries its own bottom hairline. */}
      {/* BYPASS the shared <Table> primitive: render the <table> directly inside
          this ONE scroll container so a single element scrolls BOTH axes (the
          primitive parks an inner overflow-x-auto far below the virtualized
          viewport). The `--col-*` / `--table-width` vars live here and are read
          by every cell + row below. */}
      <div
        ref={containerRef}
        className="relative max-h-[75vh] overflow-auto"
        style={colWidths.cssVars}
      >
        <table
          className="w-max caption-bottom text-sm"
          style={{ minWidth: "100%" }}
          role="grid"
          aria-multiselectable="true"
          aria-label="Work items"
          aria-rowcount={ariaRowCount}
          aria-colcount={ariaColCount}
        >
          <TableHeader role="rowgroup" className="sticky top-0 z-10 bg-background">
            <TableRow
              role="row"
              aria-rowindex={1}
              className="flex"
              style={ROW_SPAN_STYLE}
            >
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
                  data-col-id={column.id}
                  className={cn(
                    "relative",
                    column.alignRight && "text-right",
                  )}
                  style={dataColumnStyle(column.id)}
                >
                  {column.header}
                  {/* Resize handle: a focusable separator at the right border.
                      Pointer drag mutates the CSS var imperatively (no setState);
                      keyboard / double-click commit through the hook. */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${column.header} column`}
                    aria-valuemin={colWidths.minWidthOf(column.id)}
                    aria-valuemax={MAX_COLUMN_WIDTH}
                    aria-valuenow={colWidths.widths[column.id]}
                    tabIndex={0}
                    className={cn(
                      "absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize touch-none select-none",
                      "bg-transparent transition-colors hover:bg-border focus-visible:bg-ring active:bg-ring",
                      "focus-visible:outline-none",
                    )}
                    onPointerDown={(event) => {
                      colWidths.onPointerResizeStart(column.id, event);
                    }}
                    onKeyDown={(event) => {
                      colWidths.onKeyResize(column.id, event);
                    }}
                    onDoubleClick={() => {
                      colWidths.autofit(column.id);
                    }}
                  />
                </TableHead>
              ))}
              {showActions ? (
                // Presentational spacer aligned to the actions cell: NOT a
                // columnheader, so the asserted columnheader count is unchanged.
                <TableHead
                  role="presentation"
                  aria-hidden="true"
                  style={cellStyle(ACTIONS_COLUMN_WIDTH)}
                />
              ) : null}
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
                ...ROW_SPAN_STYLE,
                position: "absolute",
                top: 0,
                left: 0,
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
                    // Full-opacity band + top/bottom hairlines so the section
                    // reads as a distinct divider in both light and dark themes
                    // (the old bg-muted/40 washed out against hovered rows).
                    className="border-y border-border bg-muted"
                    style={offsetStyle}
                  >
                    <TableCell
                      role="gridcell"
                      aria-colindex={1}
                      aria-colspan={ariaColCount}
                      className="flex flex-1 items-center gap-2 text-xs font-semibold tracking-wide text-foreground uppercase"
                    >
                      <span className="truncate">{flat.label}</span>
                      {/* Group size surfaced in the band header as a pill. */}
                      <span className="shrink-0 rounded-sm bg-background px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground tabular-nums">
                        {flat.count}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              }

              const { row } = flat;
              const isSelected = selection.has(row.id);
              const isArchived = row.archived === true;
              return (
                <TableRow
                  key={flat.key}
                  role="row"
                  aria-rowindex={ariaRowIndex}
                  aria-selected={isSelected}
                  data-testid="work-item-row"
                  data-state={isSelected ? "selected" : undefined}
                  data-archived={isArchived ? "true" : undefined}
                  // `group` powers the hover/focus reveal of the row controls;
                  // archived rows are de-emphasized via a muted text token + a
                  // struck-through title (handled in the Name render), NOT a
                  // blanket opacity dim — so their status badges stay full
                  // strength and read clearly.
                  className={cn(
                    "group",
                    isArchived && "text-muted-foreground",
                    // Selection gets a DISTINCT cue that wins over hover. The
                    // primary tint is authored as the `data-[state=selected]`
                    // AND `hover` variants so twMerge swaps out the shared
                    // TableRow's `data-[state=selected]:bg-muted` /
                    // `hover:bg-muted/50` — hovering a selected row no longer
                    // lightens it back to the generic muted hue. A left accent
                    // rail (an out-of-flow `before:` pseudo → no layout shift)
                    // reads even where the tint is subtle in dark mode. All
                    // theme tokens, so it's dark-mode safe.
                    isSelected &&
                      "data-[state=selected]:bg-primary/10 hover:bg-primary/10 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary before:content-['']",
                  )}
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
                        // Capture the modifier for the range-vs-toggle branch in
                        // onCheckedChange (which receives no event of its own).
                        shiftKeyRef.current = event.shiftKey;
                      }}
                      onCheckedChange={() => {
                        handleRowSelect(virtualRow.index);
                      }}
                    />
                  </TableCell>
                  {columns.map((column, columnIndex) => (
                    <TableCell
                      key={column.id}
                      role="gridcell"
                      aria-colindex={columnIndex + 2}
                      data-col-id={column.id}
                      // `py-1.5` tightens the row to the compact 44px slot. Now
                      // every data column is a fixed resizable width, so all
                      // cells clip + ellipsize; the component cells' own
                      // min-w-0/truncate still drives their inner truncation, and
                      // the 8px cell padding keeps the Name focus ring unclipped.
                      className="overflow-hidden py-1.5 text-ellipsis"
                      style={dataColumnStyle(column.id)}
                    >
                      {column.id === "name" && isArchived ? (
                        <span className="flex min-w-0 items-center gap-2">
                          {column.render({
                            row,
                            owners,
                            onSelectItem,
                            onUpdateItem,
                            archived: isArchived,
                          })}
                          <span
                            data-testid="archived-indicator"
                            className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium"
                          >
                            Archived
                          </span>
                        </span>
                      ) : (
                        column.render({
                          row,
                          owners,
                          onSelectItem,
                          onUpdateItem,
                          archived: isArchived,
                        })
                      )}
                    </TableCell>
                  ))}
                  {showActions && onUpdateItem ? (
                    <TableCell
                      role="gridcell"
                      aria-colindex={columns.length + 2}
                      className="flex items-center justify-end"
                      style={cellStyle(ACTIONS_COLUMN_WIDTH)}
                    >
                      <RowActionsCell
                        row={row}
                        onSelectItem={onSelectItem}
                        onUpdateItem={onUpdateItem}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </table>
      </div>
    </div>
    </TooltipProvider>
  );
}
