import * as React from "react";
import { ArrowUpIcon, FlameIcon, type LucideIcon } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Work-item priority (DESIGN §5 board grammar; §11 schema). Priority is a
 * stored field on WORK ITEMS — distinct from `phase` (lifecycle) and the
 * DERIVED `health`. Values mirror the legacy `features.priority` /
 * `connection_insights.severity` DB shape (`critical | high | medium | low`,
 * see `infra/supabase/migrations/20250111000005_*.sql`) and the canonical
 * wireframe editor (`docs/design/user-flow-wireframes.html` line 583), so the
 * F2 backend migration is a no-op rename.
 */
export type Priority = "critical" | "high" | "medium" | "low";

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Severity order, highest → lowest. Single source for selects/sorts. */
export const PRIORITY_ORDER: readonly Priority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

const PRIORITY_STYLES: Record<Priority, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-accent text-accent-foreground",
  medium: "bg-secondary text-secondary-foreground",
  low: "bg-muted text-muted-foreground",
};

/** Leading glyph for the louder priorities; quieter ones stay text-only. */
const PRIORITY_ICONS: Partial<Record<Priority, LucideIcon>> = {
  critical: FlameIcon,
  high: ArrowUpIcon,
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        PRIORITY_STYLES[priority],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3" /> : null}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
