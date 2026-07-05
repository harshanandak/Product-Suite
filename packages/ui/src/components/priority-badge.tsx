import * as React from "react";
import { ArrowUpIcon, FlameIcon, type LucideIcon } from "lucide-react";

import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  type Priority,
} from "@product-suite/contracts";

import { cn } from "../lib/cn";

/**
 * Work-item priority (DESIGN §5 board grammar; §11 schema). Priority is a
 * stored field on WORK ITEMS — distinct from `phase` (lifecycle) and the
 * DERIVED `health`. Values mirror the legacy `features.priority` /
 * `connection_insights.severity` DB shape (`critical | high | medium | low`,
 * see `infra/supabase/migrations/20250111000005_*.sql`) and the canonical
 * wireframe editor (`docs/design/user-flow-wireframes.html` line 583), so the
 * F2 backend migration is a no-op rename.
 *
 * `Priority`, `PRIORITY_LABELS`, and `PRIORITY_ORDER` are the framework-neutral
 * single source of truth in `@product-suite/contracts`; re-exported here so
 * existing UI consumers are unaffected.
 */
export type { Priority };
export { PRIORITY_LABELS, PRIORITY_ORDER };

/**
 * Per-level chroma ramp (DESIGN §5) — one hue each so priority never collapses
 * into the neutral accent/secondary/muted grays, especially in dark mode. See
 * the `--priority-*` tokens in `styles/tokens.css`.
 */
const PRIORITY_STYLES: Record<Priority, string> = {
  critical: "bg-priority-critical text-priority-critical-foreground",
  high: "bg-priority-high text-priority-high-foreground",
  medium: "bg-priority-medium text-priority-medium-foreground",
  low: "bg-priority-low text-priority-low-foreground",
};

/** Leading glyph for the louder priorities; quieter ones use a dot (below). */
const PRIORITY_ICONS: Partial<Record<Priority, LucideIcon>> = {
  critical: FlameIcon,
  high: ArrowUpIcon,
};

/**
 * Leading dot for the glyph-less levels. Belt-and-suspenders: the dot carries
 * the level hue (`-foreground`) so the level still reads even if the surface
 * tint is low-contrast on a given display.
 */
const PRIORITY_DOT_STYLES: Record<Priority, string> = {
  critical: "bg-priority-critical-foreground",
  high: "bg-priority-high-foreground",
  medium: "bg-priority-medium-foreground",
  low: "bg-priority-low-foreground",
};

export interface PriorityBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  priority: Priority;
}

/**
 * Read-only priority pill (DESIGN §5). Token-pure — no ad-hoc colors. Mirrors
 * the {@link PhasePill} / {@link HealthBadge} grammar so a table cell never
 * hand-rolls a styled span for priority.
 *
 * @example
 * ```tsx
 * <PriorityBadge priority="high" />
 * ```
 */
export function PriorityBadge({
  priority,
  className,
  ...props
}: Readonly<PriorityBadgeProps>) {
  const Icon = PRIORITY_ICONS[priority];
  return (
    <span
      {...props}
      data-priority={priority}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        PRIORITY_STYLES[priority],
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="size-3" />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", PRIORITY_DOT_STYLES[priority])}
        />
      )}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
