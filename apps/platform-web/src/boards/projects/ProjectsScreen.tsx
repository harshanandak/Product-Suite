import { useMemo, useState } from "react";

import { EmptyState, ErrorState, HealthBadge } from "@product-suite/ui";

import type { WorkItemRepository } from "../../data/work-items/repository";
import { useWorkItems } from "../../data/work-items/use-work-items";

import {
  buildProjectGroups,
  formatTargetDate,
  type ProjectRow,
} from "./project-rows";

/**
 * Projects board — the outcome containers, grouped by their own status.
 *
 * Deliberate shape decisions, so the next reader does not re-litigate them:
 *  - ONE grid template (`GRID`) is shared by the header and every row, which is
 *    what lines the columns up. There are no cell borders and no per-row rules;
 *    a single hairline under the header plus a rounded hover carries it.
 *  - Every value is LEFT-justified at its column's x. Right-justifying the
 *    metadata and pinning it to the row's right edge is what strands empty space
 *    in the middle of a wide row.
 *  - Expanding a project reveals its WORK ITEMS. Projects have no `parent_id`
 *    and never nest, so this tree is project → work_items, one level, always.
 *  - Health comes from {@link HealthBadge}, the shared token-pure component, so
 *    this surface and the workboard say "At risk" in exactly the same voice.
 */

/** Shared column template: name, target, health, items, lead. */
const GRID =
  "grid grid-cols-[minmax(0,1fr)_7rem_9rem_7rem_9rem] items-center gap-x-4";

/** How many work items a project previews inline before it stops listing them. */
const INLINE_ITEM_LIMIT = 8;

export interface ProjectsScreenProps {
  /** Repository to read through; defaults to the module singleton. */
  readonly repository?: WorkItemRepository;
  /**
   * Called with a work item's id when the reader opens it. The screen stays
   * router-free so it can be tested without a router; the route wires this to
   * navigation.
   */
  readonly onOpenItem?: (itemId: string) => void;
}

export function ProjectsScreen({
  repository,
  onOpenItem,
}: Readonly<ProjectsScreenProps>) {
  const { items, projects, owners, loading, error } = useWorkItems({ repository });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const groups = useMemo(
    () => buildProjectGroups(projects, items),
    [projects, items],
  );

  const ownerName = useMemo(() => {
    const byId = new Map(owners.map((owner) => [owner.id, owner.name]));
    return (leadId: string | null) => (leadId === null ? null : byId.get(leadId) ?? null);
  }, [owners]);

  function toggle(projectId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState
          title="Could not load projects"
          description={error.message}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <output className="block space-y-3 p-6" aria-label="Loading projects">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
      </output>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No projects yet"
          description="Projects group work items toward an outcome. Create one to get started."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-24">
      <header className="flex h-14 items-center">
        <h1 className="text-sm font-semibold">Projects</h1>
      </header>

      <div
        className={`${GRID} sticky top-0 z-10 border-b bg-background px-3 py-2`}
      >
        <span className="text-xs font-medium text-muted-foreground">Name</span>
        <span className="text-xs font-medium text-muted-foreground">Target</span>
        <span className="text-xs font-medium text-muted-foreground">Health</span>
        <span className="text-xs font-medium text-muted-foreground">Items</span>
        <span className="text-xs font-medium text-muted-foreground">Lead</span>
      </div>

      {groups.map((group) => (
        <section key={group.status}>
          <div className="flex items-center gap-2 px-3 pt-7 pb-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {group.label}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground/70">
              {group.rows.length}
            </span>
          </div>

          {group.rows.map((row) => (
            <ProjectListRow
              key={row.project.id}
              row={row}
              expanded={expanded.has(row.project.id)}
              leadName={ownerName(row.project.lead_id)}
              onToggle={() => toggle(row.project.id)}
              onOpenItem={onOpenItem}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

interface ProjectListRowProps {
  readonly row: ProjectRow;
  readonly expanded: boolean;
  readonly leadName: string | null;
  readonly onToggle: () => void;
  readonly onOpenItem?: (itemId: string) => void;
}

function ProjectListRow({
  row,
  expanded,
  leadName,
  onToggle,
  onOpenItem,
}: Readonly<ProjectListRowProps>) {
  const { project } = row;
  const shown = row.items.slice(0, INLINE_ITEM_LIMIT);
  const hidden = row.items.length - shown.length;

  return (
    <>
      <div className={`${GRID} min-h-12 rounded-lg px-3 py-2 hover:bg-accent/40`}>
        <span className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              <path
                d="M6 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="truncate text-sm font-medium">{project.name}</span>
        </span>

        <span className="text-sm tabular-nums text-muted-foreground">
          {formatTargetDate(project.target_date)}
        </span>

        <span data-testid={`project-health-${project.id}`}>
          {row.health === null ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <HealthBadge health={row.health} />
          )}
        </span>

        <span
          data-testid={`project-progress-${project.id}`}
          className="text-sm tabular-nums text-muted-foreground"
        >
          <span className="font-medium text-foreground">{row.doneCount}</span>/
          {row.totalCount}
        </span>

        <span className="truncate text-sm text-muted-foreground">
          {leadName ?? "Unassigned"}
        </span>
      </div>

      {expanded &&
        (row.items.length === 0 ? (
          <p className="py-2 pl-14 text-sm text-muted-foreground">
            No work items in this project yet.
          </p>
        ) : (
          <>
            {shown.map((item, index) => (
              <div key={item.id} className={`${GRID} rounded-lg px-3 hover:bg-accent/40`}>
                <span className="flex min-w-0 items-stretch gap-2">
                  <TreeConnector last={index === shown.length - 1} />
                  <button
                    type="button"
                    onClick={() => onOpenItem?.(item.id)}
                    className="min-w-0 truncate py-2 text-left text-sm hover:underline"
                  >
                    {item.title}
                  </button>
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatTargetDate(item.due_date)}
                </span>
                <span>
                  <HealthBadge health={item.health} />
                </span>
                <span />
                <span />
              </div>
            ))}
            {hidden > 0 && (
              <p className="py-2 pl-14 text-sm text-muted-foreground">
                +{hidden} more {hidden === 1 ? "item" : "items"}
              </p>
            )}
          </>
        ))}
    </>
  );
}

/**
 * The child's tree connector — same geometry as the workboard's nested rows, so
 * the two surfaces read identically. `preserveAspectRatio="none"` plus a
 * non-scaling stroke keeps the elbow's curve at any row height while the spine
 * stretches, and the overshoot past the viewBox is what makes consecutive
 * siblings join into one unbroken line instead of a dashed ladder.
 */
function TreeConnector({ last }: Readonly<{ last: boolean }>) {
  return (
    <span aria-hidden="true" className="relative w-8 shrink-0 self-stretch text-border">
      <svg
        className="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 32 32"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <path
          d={
            last
              ? "M10 -10 V10 Q10 16 16 16 H34"
              : "M10 -10 V42 M10 10 Q10 16 16 16 H34"
          }
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}
