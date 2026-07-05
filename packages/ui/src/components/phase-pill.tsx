import * as React from "react";
import { CheckIcon } from "lucide-react";

import { PHASE_LABELS, type Phase } from "@product-suite/contracts";

import { cn } from "../lib/cn";

/**
 * Work-item phase pill (DESIGN §5 / §14). The phase loop runs
 * plan → execute → review → done and lives on WORK ITEMS ONLY.
 * Never use this for task or agent-run status — that is `StatusPill`.
 *
 * `Phase` and `PHASE_LABELS` are the framework-neutral single source of truth
 * in `@product-suite/contracts`; re-exported here so existing UI consumers are
 * unaffected.
 */
export type { Phase };
export { PHASE_LABELS };

/**
 * Inverted phase hierarchy (DESIGN §5): emphasis follows the LIVE work, not the
 * finished work. The active `execute` phase carries the brand-indigo chroma;
 * `done` recedes to the quietest muted chip (with a check glyph). Plan/execute/
 * review own per-level `--phase-*` hues so phase never reads as a neutral gray.
 */
const PHASE_STYLES: Record<Phase, string> = {
  plan: "bg-phase-plan text-phase-plan-foreground",
  execute: "bg-phase-execute text-phase-execute-foreground",
  review: "bg-phase-review text-phase-review-foreground",
  done: "bg-muted text-muted-foreground",
};

/**
 * Colored leading dot per active phase (the hue, `-foreground`), so the level
 * survives a low-contrast surface. `done` uses a check glyph instead (below).
 */
const PHASE_DOT_STYLES: Record<Exclude<Phase, "done">, string> = {
  plan: "bg-phase-plan-foreground",
  execute: "bg-phase-execute-foreground",
  review: "bg-phase-review-foreground",
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
      {...props}
      data-phase={phase}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        PHASE_STYLES[phase],
        className,
      )}
    >
      {phase === "done" ? (
        <CheckIcon aria-hidden="true" className="size-3" />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", PHASE_DOT_STYLES[phase])}
        />
      )}
      {PHASE_LABELS[phase]}
    </span>
  );
}
