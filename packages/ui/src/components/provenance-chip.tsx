import * as React from "react";
import {
  BotIcon,
  MessageSquareIcon,
  UserIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Work-item SOURCE / provenance (DESIGN §5; §11 "every auto-created object
 * carries provenance (source type + id)"). Where an object came from — the
 * "Source" column in the plan table
 * (`docs/design/user-flow-wireframes.html` lines 377/384, which enumerates the
 * four sources with their icons).
 */
export type WorkItemSource = "manual" | "meeting" | "agent" | "feedback";

export const WORK_ITEM_SOURCE_LABELS: Record<WorkItemSource, string> = {
  manual: "Manual",
  meeting: "Meeting",
  agent: "Agent",
  feedback: "Feedback",
};

/** Per-source lucide icon (the wireframe's Tabler icons mapped to lucide). */
const WORK_ITEM_SOURCE_ICONS: Record<WorkItemSource, LucideIcon> = {
  manual: UserIcon,
  meeting: VideoIcon,
  agent: BotIcon,
  feedback: MessageSquareIcon,
};

export interface ProvenanceChipProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  /** The provenance source type. */
  source: WorkItemSource;
  /**
   * Optional human label for the specific origin (e.g. `"Weekly sync 28:51"`).
   * When omitted the source label is shown (e.g. `"Agent"`).
   */
  label?: string;
}

/**
 * Read-only provenance chip (DESIGN §5) linking an object back to its source
 * with a per-source icon. The icon is decorative (`aria-hidden`); the source is
 * always announced in text so screen readers convey provenance without relying
 * on color or glyph.
 *
 * @example
 * ```tsx
 * <ProvenanceChip source="meeting" label="Weekly sync 28:51" />
 * <ProvenanceChip source="manual" />
 * ```
 */
export function ProvenanceChip({
  source,
  label,
  className,
  ...props
}: Readonly<ProvenanceChipProps>) {
  const Icon = WORK_ITEM_SOURCE_ICONS[source];
  const sourceLabel = WORK_ITEM_SOURCE_LABELS[source];
  return (
    <span
      {...props}
      data-source={source}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label === undefined ? (
        sourceLabel
      ) : (
        <>
          <span className="sr-only">{sourceLabel}: </span>
          {label}
        </>
      )}
    </span>
  );
}
