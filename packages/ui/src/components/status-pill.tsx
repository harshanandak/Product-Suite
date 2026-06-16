import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Status pill (DESIGN §5 / §14). Status lives on TASKS and AGENT RUNS ONLY —
 * never on work items (those carry phase via `PhasePill`). Task status is the
 * fixed triad To-do / In progress / Completed.
 */
export type TaskStatus = "todo" | "in_progress" | "completed";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To-do",
  in_progress: "In progress",
  completed: "Completed",
};

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "border border-border text-muted-foreground",
  in_progress: "bg-accent text-accent-foreground",
  completed: "bg-primary text-primary-foreground",
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: TaskStatus;
}

export function StatusPill({ status, className, ...props }: StatusPillProps) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
      {...props}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
