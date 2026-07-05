import * as React from "react";

import { HEALTH_LABELS, type Health } from "@product-suite/contracts";

import { cn } from "../lib/cn";

/**
 * Health badge (DESIGN §3/§5). Health is ALWAYS DERIVED — never hand-set,
 * never a stored column. Rendered from computed signals (overdue tasks,
 * blockers). Token-pure: only semantic tokens, no ad-hoc colors.
 *
 * `Health` and `HEALTH_LABELS` are the framework-neutral single source of truth
 * in `@product-suite/contracts`; re-exported here so existing UI consumers are
 * unaffected.
 */
export type { Health };
export { HEALTH_LABELS };

const HEALTH_STYLES: Record<Health, string> = {
  on_track: "bg-muted text-muted-foreground",
  at_risk: "bg-accent text-accent-foreground",
  blocked: "bg-destructive text-destructive-foreground",
};

const DOT_STYLES: Record<Health, string> = {
  on_track: "bg-muted-foreground/60",
  at_risk: "bg-accent-foreground",
  blocked: "bg-destructive-foreground",
};

export interface HealthBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  health: Health;
}

export function HealthBadge({
  health,
  className,
  ...props
}: Readonly<HealthBadgeProps>) {
  return (
    <span
      {...props}
      data-health={health}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        HEALTH_STYLES[health],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", DOT_STYLES[health])}
      />
      {HEALTH_LABELS[health]}
    </span>
  );
}
