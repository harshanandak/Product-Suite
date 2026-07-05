import * as React from "react";

import { STATUS_LABELS, type TaskStatus } from "@product-suite/contracts";

import { cn } from "../lib/cn";

/**
 * Status pill (DESIGN §5 / §14). Status lives on TASKS and AGENT RUNS ONLY —
 * never on work items (those carry phase via `PhasePill`). Task status is the
 * fixed triad To-do / In progress / Completed.
 *
 * `TaskStatus` and `STATUS_LABELS` are the framework-neutral single source of
 * truth in `@product-suite/contracts`; re-exported here so existing UI
 * consumers are unaffected.
 */
export type { TaskStatus };
export { STATUS_LABELS };

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "border border-border text-muted-foreground",
  in_progress: "bg-accent text-accent-foreground",
  completed: "bg-primary text-primary-foreground",
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: TaskStatus;
}

export function StatusPill({
  status,
  className,
  ...props
}: Readonly<StatusPillProps>) {
  return (
    <span
      {...props}
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
