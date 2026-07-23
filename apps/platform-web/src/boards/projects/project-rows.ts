/**
 * Projects board — the pure read-model behind the list surface.
 *
 * Everything here is derivation, never storage. Two rules from the data model
 * shape the whole file:
 *
 *  - A project's HEALTH is derived, never persisted (schema.ts:199, and the same
 *    rule the work-item seam states). We do NOT introduce a second scoring
 *    model: each work item already carries its own `health`, derived once by
 *    `deriveHealth`, and a project simply reports the WORST health among its
 *    items. A project with no items reports `null` — an honest "nothing to
 *    report" rather than a flattering "On track".
 *  - A project's PROGRESS counts its WORK ITEMS (`work_items.project_id`), never
 *    other projects: the `projects` table has no `parent_id`, so projects do not
 *    nest and a project can never contain a project. The counts themselves are
 *    computed SERVER-SIDE (`GET /api/projects`, a `group by project_id`) and
 *    arrive on {@link ProjectWithCounts} — this file reads them off the project
 *    record rather than counting `items` itself, so rendering the board never
 *    requires loading the whole work-item set.
 */
import {
  HEALTH_ORDER,
  PROJECT_STATUS_VALUES,
  type Health,
  type ProjectStatus,
} from "@product-suite/contracts";

import type { ProjectWithCounts, WorkItemRow } from "../../data/work-items/types";

/**
 * Display order of the status groups — deliberately NOT the enum's declaration
 * order: the work you are doing sorts above the work you have parked, and the
 * closed states sink to the bottom. Kept exhaustive over {@link ProjectStatus}
 * by `project-rows.test.ts`, so a newly added status can never silently drop off
 * the board.
 */
export const PROJECT_GROUP_ORDER = [
  "in_progress",
  "planned",
  "paused",
  "backlog",
  "completed",
  "canceled",
] as const satisfies readonly ProjectStatus[];

/** Human labels for the status groups (the section headers). */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  in_progress: "In Progress",
  planned: "Planned",
  paused: "Paused",
  backlog: "Backlog",
  completed: "Completed",
  canceled: "Canceled",
};

/** One project as the board renders it: the record plus its derived rollup. */
export interface ProjectRow {
  readonly project: ProjectWithCounts;
  /** Work items under this project whose phase is `done` — server-computed, `project.doneCount`. */
  readonly doneCount: number;
  /** All work items under this project — server-computed, `project.totalCount`. */
  readonly totalCount: number;
  /** Worst member health, or `null` when the project has no work items. */
  readonly health: Health | null;
  /** This project's work items, in the order supplied. */
  readonly items: readonly WorkItemRow[];
}

/** A status section of the board. */
export interface ProjectGroup {
  readonly status: ProjectStatus;
  readonly label: string;
  readonly rows: readonly ProjectRow[];
}

/** Worst-of comparison over the canonical health ordering (best → worst). */
function worseOf(a: Health | null, b: Health): Health {
  if (a === null) return b;
  return HEALTH_ORDER.indexOf(b) > HEALTH_ORDER.indexOf(a) ? b : a;
}

/**
 * Fold an already-sliced item list into the health a row displays. The counts
 * are NOT derived here — they are `project.totalCount`/`project.doneCount`,
 * computed server-side — so this only has to fold health (still a client-side
 * derivation, per `deriveHealth`) over the project's own items.
 */
function foldItems(
  project: ProjectWithCounts,
  mine: readonly WorkItemRow[],
): ProjectRow {
  let health: Health | null = null;
  for (const item of mine) {
    health = worseOf(health, item.health);
  }

  return { project, doneCount: project.doneCount, totalCount: project.totalCount, health, items: mine };
}

/**
 * Bucket every work item by its project in ONE pass, so grouping the board costs
 * O(items + projects) rather than re-scanning the whole item set once per
 * project. Items with no project are dropped here — they belong to no row.
 */
function bucketByProject(
  items: readonly WorkItemRow[],
): ReadonlyMap<string, WorkItemRow[]> {
  const buckets = new Map<string, WorkItemRow[]>();
  for (const item of items) {
    const projectId = item.project_id;
    if (projectId === null) continue;
    const bucket = buckets.get(projectId);
    if (bucket === undefined) buckets.set(projectId, [item]);
    else bucket.push(item);
  }
  return buckets;
}

/**
 * Fold one project's work items into the counts and health the row displays.
 * `items` may be the whole board's item set — it is filtered by `project_id`
 * here, so callers never have to pre-slice it. Prefer {@link buildProjectGroups}
 * for whole-board work: this convenience form is O(items) per call by design.
 */
export function rollUpProject(
  project: ProjectWithCounts,
  items: readonly WorkItemRow[],
): ProjectRow {
  return foldItems(
    project,
    items.filter((item) => item.project_id === project.id),
  );
}

/**
 * Group every project into its status section, in {@link PROJECT_GROUP_ORDER}.
 * Empty sections are omitted rather than rendered as empty headers.
 *
 * Cost is O(items + projects): the item set is bucketed once up front, then each
 * project reads its own bucket. Projects are indexed by status in the same
 * single pass, so the status ordering does not re-scan the project list either.
 */
export function buildProjectGroups(
  projects: readonly ProjectWithCounts[],
  items: readonly WorkItemRow[],
): ProjectGroup[] {
  const buckets = bucketByProject(items);

  const byStatus = new Map<ProjectStatus, ProjectRow[]>();
  for (const project of projects) {
    const row = foldItems(project, buckets.get(project.id) ?? []);
    const existing = byStatus.get(project.status);
    if (existing === undefined) byStatus.set(project.status, [row]);
    else existing.push(row);
  }

  return PROJECT_GROUP_ORDER.flatMap((status) => {
    const rows = byStatus.get(status);
    return rows === undefined || rows.length === 0
      ? []
      : [{ status, label: PROJECT_STATUS_LABELS[status], rows }];
  });
}

/**
 * ONE target-date format for the whole column. `target_date` is a single date
 * column, so it cannot honestly render as a quarter for some rows and a month
 * for others; month + year is the least misleading reading of a single date.
 * An absent or unparseable value degrades to an em dash, never `NaN`.
 */
export function formatTargetDate(target: string | null): string {
  if (target === null) return "—";
  const parsed = new Date(target);
  if (Number.isNaN(parsed.getTime())) return "—";
  return `${parsed.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${parsed.getUTCFullYear()}`;
}

/** Every status the contract defines — re-exported so tests can assert coverage. */
export { PROJECT_STATUS_VALUES };
