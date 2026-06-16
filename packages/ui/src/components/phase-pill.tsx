import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Work-item phase pill (DESIGN §5 / §14). The phase loop runs
 * plan → execute → review → done and lives on WORK ITEMS ONLY.
 * Never use this for task or agent-run status — that is `StatusPill`.
 */
export type Phase = "plan" | "execute" | "review" | "done";

export const PHASE_LABELS: Record<Phase, string> = {
  plan: "Plan",
  execute: "Execute",
  review: "Review",
  done: "Done",
};

const PHASE_STYLES: Record<Phase, string> = {
  plan: "bg-muted text-muted-foreground",
  execute: "bg-accent text-accent-foreground",
  review: "bg-secondary text-secondary-foreground",
  done: "bg-primary text-primary-foreground",
};

export interface PhasePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  phase: Phase;
}

export function PhasePill({
  phase,
  className,
  ...props
}: Readonly<PhasePillProps>) {
  return (
    <span
      data-phase={phase}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        PHASE_STYLES[phase],
        className,
      )}
      {...props}
    >
      {PHASE_LABELS[phase]}
    </span>
  );
}
