import { useEffect, useRef, useState } from "react";

import { useParams, useSearch } from "@tanstack/react-router";

import { Button, EmptyState, ErrorState } from "@product-suite/ui";

import {
  useProposals,
  type Proposal,
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
  // `?proposal=<id>` deep-links a specific proposal (the chat panel's "Review in
  // Inbox →" target). Preselect it when present + still pending, else fall back
  // to the first row.
  const { proposal: requestedId } = useSearch({ from: "/w/$workspace/inbox" });
  const { proposals, isLoading, error, accept, reject, isMutating, refetch } =
    useProposals({ repository });

  // The selected proposal id (detail-pane target). Default to the deep-linked
  // proposal (when it exists), else the first proposal once the list arrives —
  // then NEVER auto-jump: a proposal disposed of via the detail pane leaves the
  // pending list on refetch, but we keep its terminal confirmation ("Applied →
  // view item" / stale) visible until the user picks another row instead of
  // yanking the pane to a different proposal.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The last `?proposal=<id>` we honored. A NEW deep-link (the chat panel's
  // "Review in Inbox →") must retarget the pane even when the inbox is already
  // open with a different proposal selected — so we react to the id CHANGING,
  // not just to an empty selection.
  const appliedRequestRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      requestedId &&
      requestedId !== appliedRequestRef.current &&
      proposals.some((p) => p.id === requestedId)
    ) {
      appliedRequestRef.current = requestedId;
      setSelectedId(requestedId);
      return;
    }
    // Otherwise default a still-empty selection to the first row once loaded;
    // never auto-jump an existing selection (keeps a terminal banner visible).
    setSelectedId((current) => current ?? proposals[0]?.id ?? null);
  }, [proposals, requestedId]);

  // Cache every proposal we've shown so the detail pane can keep rendering a
  // just-disposed proposal (dropped from the refetched list) with its terminal
  // status, rather than blanking the moment the server confirms the disposition.
  const seenRef = useRef<Map<string, Proposal>>(new Map());
  useEffect(() => {
    for (const proposal of proposals) seenRef.current.set(proposal.id, proposal);
  }, [proposals]);

  const selected =
    selectedId === null
      ? null
      : (proposals.find((proposal) => proposal.id === selectedId) ??
        seenRef.current.get(selectedId) ??
        null);

  // Ignore row selection while an accept/reject is in flight, so the detail pane
  // can't be yanked to a different proposal mid-mutation — the disposition (and
  // its eventual Applied/Rejected/Stale/Error banner) stays with the item acted on.
  const selectProposal = (id: string): void => {
    if (!isMutating) setSelectedId(id);
  };

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
        <ul
          className="flex list-none flex-col gap-2.5 p-0"
          aria-label="Pending proposals"
        >
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <ProposalListItem
                proposal={proposal}
                selected={proposal.id === selectedId}
                onSelect={selectProposal}
              />
            </li>
          ))}
        </ul>

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
