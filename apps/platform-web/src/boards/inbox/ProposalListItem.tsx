import { Badge, cn } from "@product-suite/ui";

import type { Proposal } from "@/data/proposals";

import {
  formatConfidence,
  formatCreatedAt,
  proposalListTitle,
} from "./field-diff";

/** Props for {@link ProposalListItem}. */
export interface ProposalListItemProps {
  proposal: Proposal;
  /** Whether this row is the currently-selected proposal (detail pane target). */
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * One row in the review inbox list — the navigation affordance. Ports the
 * mockup's `.item` card (bordered `bg-card` panel, hover lift, an operation dot +
 * name, a small uppercase kind pill, a muted meta line) into `packages/ui`
 * primitives + semantic tokens, so the inbox reads as a sibling of the work-item
 * board. It is a `<button>` (it SELECTS, not navigates), so keyboard/AT users can
 * reach it; the selected row gets the indigo `--primary` ring.
 */
export function ProposalListItem({
  proposal,
  selected,
  onSelect,
}: Readonly<ProposalListItemProps>) {
  const confidence = formatConfidence(proposal.confidence);
  const isCreate = proposal.operation === "create";

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(proposal.id)}
      className={cn(
        "group block w-full rounded-lg border bg-card px-4 py-3.5 text-left transition-[box-shadow,border-color]",
        "hover:border-muted-foreground/50 hover:shadow-sm",
        selected
          ? "border-primary ring-1 ring-primary/30"
          : "border-border",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "h-2 w-2 flex-none rounded-full",
            isCreate ? "bg-primary" : "bg-muted-foreground",
          )}
        />
        <span className="truncate text-sm font-semibold text-foreground">
          {proposalListTitle(proposal)}
        </span>
        <Badge
          variant="secondary"
          className="px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-wide"
        >
          {proposal.operation}
        </Badge>
        {confidence ? (
          <Badge
            variant="outline"
            className="ml-auto font-mono text-[11px] text-muted-foreground"
            title="Model confidence"
          >
            {confidence}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-x-4 text-xs text-muted-foreground">
        <span className="font-mono">{proposal.model_id}</span>
        <span className="ml-auto">{formatCreatedAt(proposal.created_at)}</span>
      </div>
    </button>
  );
}
