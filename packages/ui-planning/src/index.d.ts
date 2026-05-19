import type { ReactNode } from "react";

export type PlanningPriority = "critical" | "high" | "medium" | "low" | string;
export type PlanningTimelinePhase = "MVP" | "SHORT" | "LONG" | "UNASSIGNED";

export interface PlanningItemRecord {
  id?: string;
  title?: string;
  name?: string;
  status?: string;
  priority?: PlanningPriority;
  phase?: string;
  timeline?: string;
  timelinePhase?: string;
}

export interface PlanningSummaryBlockProps {
  title?: string;
  items?: PlanningItemRecord[];
  emptyLabel?: string;
  children?: ReactNode;
}

export function getPlanningItemTitle(item?: PlanningItemRecord): string;
export function normalizeTimelinePhase(phase?: unknown): PlanningTimelinePhase;
export function groupTimelineItemsByPhase<T extends PlanningItemRecord>(
  items?: T[],
): Record<PlanningTimelinePhase, T[]>;
export function sortPlanningItemsByPriority<T extends PlanningItemRecord>(items?: T[]): T[];
export function PlanningSummaryBlock(props: PlanningSummaryBlockProps): ReactNode;
