import * as React from "react";
import {
  BugIcon,
  FlaskConicalIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Work-item TYPE (DESIGN §5 board grammar; §11 schema). The kind of work a
 * work item represents — the "Type" column in the plan table
 * (`docs/design/user-flow-wireframes.html` line 377).
 *
 * Note: the wireframe editor (line 581) lists `feature | task | bug |
 * enhancement`, but `task` is a DISTINCT object in the ladder (project → work
 * item → task, §1/§11) and cannot also be a work-item type, so it is dropped;
 * `enhancement` folds into `feature`. The canonical set is the
 * project-management quartet below.
 */
export type WorkItemType = "feature" | "bug" | "chore" | "research";

export const WORK_ITEM_TYPE_LABELS: Record<WorkItemType, string> = {
  feature: "Feature",
  bug: "Bug",
  chore: "Chore",
  research: "Research",
};

/** Display order. Single source for selects/sorts. */
export const WORK_ITEM_TYPE_ORDER: readonly WorkItemType[] = [
  "feature",
  "bug",
  "chore",
  "research",
];

const WORK_ITEM_TYPE_ICONS: Record<WorkItemType, LucideIcon> = {
  feature: SparklesIcon,
  bug: BugIcon,
  chore: WrenchIcon,
  research: FlaskConicalIcon,
};

export interface WorkItemTypeBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  type: WorkItemType;
}

/**
 * Read-only work-item-type pill with a per-type icon (DESIGN §5). Token-pure;
 * mirrors the {@link PhasePill} grammar. Uses the neutral `bg-muted` surface so
 * it reads as a category tag, not a status.
 *
 * @example
 * ```tsx
 * <WorkItemTypeBadge type="bug" />
 * ```
 */
export function WorkItemTypeBadge({
  type,
  className,
  ...props
}: Readonly<WorkItemTypeBadgeProps>) {
  const Icon = WORK_ITEM_TYPE_ICONS[type];
  return (
    <span
      {...props}
      data-type={type}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {WORK_ITEM_TYPE_LABELS[type]}
    </span>
  );
}
