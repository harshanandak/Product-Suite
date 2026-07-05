import * as React from "react";
import {
  BugIcon,
  FlaskConicalIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import {
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
  type WorkItemType,
} from "@product-suite/contracts";

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
 * project-management quartet.
 *
 * `WorkItemType`, `WORK_ITEM_TYPE_LABELS`, and `WORK_ITEM_TYPE_ORDER` are the
 * framework-neutral single source of truth in `@product-suite/contracts`;
 * re-exported here so existing UI consumers are unaffected.
 */
export type { WorkItemType };
export { WORK_ITEM_TYPE_LABELS, WORK_ITEM_TYPE_ORDER };

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
 * Read-only work-item-type tag with a per-type icon (DESIGN §5). Token-pure.
 * Rendered as an OUTLINED tag (border, transparent fill) — the only badge
 * family that is not a filled pill — so Type never reads as one more gray
 * status pill beside Phase / Priority / Health.
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
        "inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-2 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {WORK_ITEM_TYPE_LABELS[type]}
    </span>
  );
}
