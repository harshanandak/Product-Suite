import * as React from "react";

import { STATUS_LABELS, type CheckStatus } from "@product-suite/contracts";

import { cn } from "../lib/cn";

/**
 * Status pill (DESIGN §5 / §14). Status lives on CHECKS and AGENT RUNS ONLY —
 * never on work items (those carry phase via `PhasePill`). Check status is the
 * fixed triad To-do / In progress / Completed.
 *
 * `CheckStatus` and `STATUS_LABELS` are the framework-neutral single source of
 * truth in `@product-suite/contracts`; re-exported here so existing UI
 * consumers are unaffected.
 */
export type { CheckStatus };
export { STATUS_LABELS };

const STATUS_STYLES: Record<CheckStatus, string> = {
  todo: "border border-border text-muted-foreground",
  in_progress: "bg-accent text-accent-foreground",
  completed: "bg-primary text-primary-foreground",
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: CheckStatus;
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
