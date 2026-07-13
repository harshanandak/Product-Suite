import { useEffect, useState } from "react";

import { useParams } from "@tanstack/react-router";

import { Button, EmptyState, ErrorState } from "@product-suite/ui";

import {
  useProposals,
  type ProposalRepository,
} from "@/data/proposals";

import { ProposalDetail } from "./ProposalDetail";
import { ProposalListItem } from "./ProposalListItem";

/**
 * Props for {@link InboxScreen}. Like {@link WorkboardScreen}, the only prop is the
 * repository SEAM — optional, defaulting to the shared singleton — so tests can
 * drive the screen against a controlled fixture store.
 */
export interface InboxScreenProps {
  repository?: ProposalRepository;
}

/** A single loading placeholder row (mirrors the router's pending skeleton). */
function SkeletonRow() {
  return <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />;
}

/**
 * Review inbox SCREEN — the surface where humans dispose of what agents propose.
 * A pending-proposals list (navigation) beside a selected-proposal detail pane
 * (the product: *what will actually change*). Mirrors {@link WorkboardScreen}'s
 * scaffolding (repository via the provider/singleton seam, the four §4 states)
 * and ports the mockup's bordered `bg-card` panel + Geist type into the pane.
 */
export function InboxScreen({ repository }: Readonly<InboxScreenProps> = {}) {
  const { workspace } = useParams({ from: "/w/$workspace/inbox" });
  const { proposals, isLoading, error, accept, reject, isMutating, refetch } =
    useProposals({ repository });

  // The selected proposal id (detail-pane target). Reconciled whenever the list
  // changes: a refetch that removes the selected proposal (accepted/rejected)
  // falls back to the first remaining one, so the pane never strands on a ghost.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedId((current) => {
      if (current !== null && proposals.some((p) => p.id === current)) {
        return current;
      }
      return proposals[0]?.id ?? null;
    });
  }, [proposals]);

  const selected =
    proposals.find((proposal) => proposal.id === selectedId) ?? null;

  if (isLoading) {
    return (
      <output className="block space-y-2.5" aria-label="Loading proposals">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </output>
    );
  }

  if (error !== null) {
    return (
      <ErrorState
        title="Couldn't load proposals"
        description={error.message}
        action={
          <Button size="sm" variant="outline" onClick={refetch}>
            Try again
          </Button>
        }
      />
    );
  }

  if (proposals.length === 0) {
    return (
      <EmptyState
        title="No proposals to review"
        description="When an agent proposes a change, it lands here for you to accept or reject."
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold text-foreground">Review inbox</h1>
        <span className="text-sm text-muted-foreground">
          {proposals.length} pending
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div
          className="flex flex-col gap-2.5"
          role="list"
          aria-label="Pending proposals"
        >
          {proposals.map((proposal) => (
            <div role="listitem" key={proposal.id}>
              <ProposalListItem
                proposal={proposal}
                selected={proposal.id === selectedId}
                onSelect={setSelectedId}
              />
            </div>
          ))}
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          {selected ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <ProposalDetail
                key={selected.id}
                proposal={selected}
                accept={accept}
                reject={reject}
                isMutating={isMutating}
                workspace={workspace}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
