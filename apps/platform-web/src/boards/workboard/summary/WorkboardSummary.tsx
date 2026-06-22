import * as React from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  HEALTH_LABELS,
  PHASE_LABELS,
  type Health,
  type Phase,
} from "@product-suite/ui";

import type { WorkItemRow } from "@/data/work-items";

/**
 * Props for {@link WorkboardSummary} — a glanceable "roll the data into a chart"
 * strip rendered above the Workboard Table.
 *
 * The only input is the same `WorkItemRow[]` the Table renders, so the strip
 * stays a pure projection of what is on screen. Archived rows are excluded from
 * every distribution (and surfaced separately as a muted count) — they are
 * de-emphasized work, not part of the active phase/health picture.
 */
export interface WorkboardSummaryProps {
  /** The view-model rows to summarize (the Table's rows, archived included). */
  readonly rows: ReadonlyArray<WorkItemRow>;
}

/**
 * Canonical phase order (matches the phase loop plan → execute → review → done)
 * so bars read in lifecycle order rather than alphabetically.
 */
const PHASE_ORDER: readonly Phase[] = ["plan", "execute", "review", "done"];

/** Canonical health order — best to worst, so "blocked" reads as the tail. */
const HEALTH_ORDER: readonly Health[] = ["on_track", "at_risk", "blocked"];

/**
 * Token color per phase, kept in lockstep with `PhasePill`'s background hues
 * (DESIGN §5 — token-pure, no raw hex). recharts `fill` takes the `var(...)`
 * string directly, so these flow straight onto each `<Cell>`.
 */
const PHASE_FILL: Record<Phase, string> = {
  plan: "var(--muted)",
  execute: "var(--accent)",
  review: "var(--secondary)",
  done: "var(--primary)",
};

/** Token color per health, matching `HealthBadge`'s background hues. */
const HEALTH_FILL: Record<Health, string> = {
  on_track: "var(--muted)",
  at_risk: "var(--accent)",
  blocked: "var(--destructive)",
};

/** A single labelled, counted, colored bar datum. */
interface SummaryDatum {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly fill: string;
}

/** Tally `rows` by a keyed dimension, preserving a fixed display order. */
function tally<K extends string>(
  rows: ReadonlyArray<WorkItemRow>,
  order: readonly K[],
  pick: (row: WorkItemRow) => K,
  labels: Record<K, string>,
  fills: Record<K, string>,
): SummaryDatum[] {
  const counts = new Map<K, number>(order.map((key) => [key, 0]));
  for (const row of rows) {
    const key = pick(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.map((key) => ({
    key,
    label: labels[key],
    count: counts.get(key) ?? 0,
    fill: fills[key],
  }));
}

/** Compose "Plan 3, Execute 3, …" from a tallied dimension. */
function describe(data: ReadonlyArray<SummaryDatum>): string {
  return data.map((datum) => `${datum.label} ${datum.count}`).join(", ");
}

/**
 * One compact horizontal bar chart for a single dimension. Heightless on its
 * own — the parent grid sizes it — and silent to AT (the parent owns the
 * `role="img"` summary), so this stays purely visual with a hover `<Tooltip>`.
 */
function DistributionChart({
  data,
}: Readonly<{ data: ReadonlyArray<SummaryDatum> }>) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        layout="vertical"
        data={data as SummaryDatum[]}
        margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
        barCategoryGap={4}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={64}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: "var(--accent)", opacity: 0.3 }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--popover-foreground)",
            fontSize: 12,
          }}
          formatter={(value: number) => [value, "Items"]}
        />
        <Bar dataKey="count" radius={2} isAnimationActive={false}>
          {data.map((datum) => (
            <Cell key={datum.key} fill={datum.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * `WorkboardSummary` — a short (~96px) strip that rolls the visible rows into
 * two compact bar charts: phase distribution and (derived) health distribution.
 *
 * Counts EXCLUDE archived rows (those are de-emphasized work); when any archived
 * rows are present the count is shown as a muted footnote. A visually-hidden
 * `role="img"` summary carries the full breakdown so the strip is never silent
 * to assistive tech, and each chart adds a hover `<Tooltip>` for sighted detail.
 */
export function WorkboardSummary({ rows }: Readonly<WorkboardSummaryProps>) {
  const { active, archivedCount } = React.useMemo(() => {
    const activeRows = rows.filter((row) => row.archived !== true);
    return {
      active: activeRows,
      archivedCount: rows.length - activeRows.length,
    };
  }, [rows]);

  const phaseData = React.useMemo(
    () =>
      tally(
        active,
        PHASE_ORDER,
        (row) => row.phase,
        PHASE_LABELS,
        PHASE_FILL,
      ),
    [active],
  );
  const healthData = React.useMemo(
    () =>
      tally(
        active,
        HEALTH_ORDER,
        (row) => row.health,
        HEALTH_LABELS,
        HEALTH_FILL,
      ),
    [active],
  );

  const archivedSuffix =
    archivedCount > 0 ? `. ${archivedCount} archived (excluded)` : "";
  const ariaLabel =
    active.length === 0
      ? `No active work items to summarize${archivedSuffix}`
      : `${active.length} active work items. ` +
        `By phase: ${describe(phaseData)}. ` +
        `By health: ${describe(healthData)}${archivedSuffix}`;

  return (
    <section
      aria-label="Workboard summary"
      data-testid="workboard-summary"
      className="rounded-lg border border-border bg-card px-4 py-3 text-card-foreground"
    >
      {/* Visually-hidden, machine-readable rollup — the single AT surface. */}
      <p role="img" aria-label={ariaLabel} className="sr-only">
        {ariaLabel}
      </p>

      {active.length === 0 ? (
        <p
          data-testid="workboard-summary-empty"
          className="text-sm text-muted-foreground"
        >
          No active work items to summarize.
          {archivedCount > 0 ? ` ${archivedCount} archived.` : ""}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
          <figure className="m-0 h-24">
            <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
              Phase
            </figcaption>
            <div className="h-[calc(100%-1.25rem)]">
              <DistributionChart data={phaseData} />
            </div>
          </figure>
          <figure className="m-0 h-24">
            <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
              Health
            </figcaption>
            <div className="h-[calc(100%-1.25rem)]">
              <DistributionChart data={healthData} />
            </div>
          </figure>
        </div>
      )}

      {archivedCount > 0 && active.length > 0 ? (
        <p
          data-testid="workboard-summary-archived"
          className="mt-2 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          {archivedCount} archived item{archivedCount === 1 ? "" : "s"} excluded.
        </p>
      ) : null}
    </section>
  );
}
