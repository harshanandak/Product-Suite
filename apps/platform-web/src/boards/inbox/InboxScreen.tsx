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
 * The source-facet options. `all` shows everything (including null-source
 * proposals); each other value filters to that origin. The union of `value`s is
 * derived from this tuple, so adding a facet needs no separate type change.
 */
const SOURCE_FACETS = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chat" },
  { value: "autonomous", label: "Autonomous" },
  { value: "connector", label: "Connector" },
] as const;

/** The active source filter — `all`, or one of the `ProposalSource` literals. */
type SourceFilter = (typeof SOURCE_FACETS)[number]["value"];

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
  const { proposals, isLoading, error, accept, reject, undo, isMutating, refetch } =
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

  // The source facet (chat / autonomous / connector) narrows the list to one
  // origin; `all` (default) shows every proposal, including null-source ones.
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const visibleProposals =
    sourceFilter === "all"
      ? proposals
      : proposals.filter((proposal) => proposal.source === sourceFilter);

  // When the facet hides the currently-selected proposal WHILE it is still
  // pending, fall back to the first visible row. Guard on it being in the pending
  // list so a just-disposed proposal (kept alive via seenRef for its terminal
  // banner) is never yanked away — that path leaves `selectedId` untouched.
  useEffect(() => {
    if (selectedId === null) return;
    const stillPending = proposals.some((p) => p.id === selectedId);
    const isVisible = visibleProposals.some((p) => p.id === selectedId);
    if (stillPending && !isVisible) {
      setSelectedId(visibleProposals[0]?.id ?? null);
    }
  }, [visibleProposals, proposals, selectedId]);

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

  // The full skeleton shows ONLY on the initial load (no data yet). A refetch
  // after accept/reject raises `isRefetching`, NOT `isLoading`, so we fall through
  // and keep the current list + detail pane mounted while it reloads — otherwise
  // accepting the LAST proposal flips a skeleton in and discards the terminal
  // "Applied → View item" banner mid-refetch (a second discard path; 7218a03e).
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

  // Only the TRUE empty inbox shows the teaching empty state. When the pending
  // list is empty but we still have a cached selection (`selected` resolved from
  // seenRef above — a proposal just disposed via the detail pane), fall through
  // and render the detail pane so its terminal "Applied → View item" / stale
  // banner stays visible instead of blanking. Without the `selected === null`
  // guard, accepting the LAST pending proposal silently loses that confirmation.
  if (proposals.length === 0 && selected === null) {
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
          {visibleProposals.length} pending
        </span>
      </header>

      {/* Source facet — the ONE approval surface's origin filter (chat /
          autonomous / connector), absorbing the old Agent-board Approvals queue. */}
      <div
        role="group"
        aria-label="Filter by source"
        className="flex flex-wrap gap-1.5"
      >
        {SOURCE_FACETS.map((facet) => {
          const active = sourceFilter === facet.value;
          return (
            <button
              key={facet.value}
              type="button"
              aria-pressed={active}
              onClick={() => setSourceFilter(facet.value)}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground")
              }
            >
              {facet.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ul
          className="flex list-none flex-col gap-2.5 p-0"
          aria-label="Pending proposals"
        >
          {visibleProposals.map((proposal) => (
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
                // Undo-on-accept: the Applied banner keeps an escape hatch, so a
                // reviewer who accepts and immediately regrets it is not stuck
                // hand-reverting the item on the workboard.
                undo={undo}
                isMutating={isMutating}
                workspace={workspace}
                onRefresh={refetch}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
