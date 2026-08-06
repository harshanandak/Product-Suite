import { useEffect, useRef, useState } from "react";

import { Link, useParams, useSearch } from "@tanstack/react-router";

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
 * The fate of a `?proposal=<id>` deep-link that is NOT in the pending list. Every
 * non-`idle` state means NOTHING is selected: the reviewer asked for a specific
 * proposal, so the inbox must say what happened to it rather than quietly promoting
 * a different pending change into the pane — where an Accept click would approve
 * something the reviewer never asked to see.
 */
type DeepLinkState =
  | { kind: "idle" }
  /** The lookup is in flight (we do not yet know which of the two it is). */
  | { kind: "checking" }
  /** No such proposal exists for this caller. */
  | { kind: "missing" }
  | { kind: "error"; message: string }
  /** It exists but has been decided already — `status` is its lifecycle status. */
  | {
      kind: "disposed";
      status: string;
      targetId: string | null;
      targetType: Proposal["target_type"];
    };

/**
 * The notice copy for a resolved dead deep-link. A disposed proposal is the COMMON
 * real case (a teammate handled it, or a second tab did) and reads as an outcome;
 * a genuinely unknown id reads as a bad link.
 */
function deepLinkNotice(state: DeepLinkState): { title: string; description: string } {
  if (state.kind === "error") {
    return {
      title: "Couldn't check that proposal",
      description: state.message,
    };
  }
  if (state.kind === "disposed") {
    if (state.status === "applied") {
      return {
        title: "That proposal was already accepted",
        description: "Its change has been applied, so there is nothing left to review.",
      };
    }
    if (state.status === "rejected") {
      return {
        title: "That proposal was already rejected",
        description: "Someone declined it, so it is no longer waiting on you.",
      };
    }
    return {
      title: "That proposal is no longer pending",
      description: `It was already handled (${state.status}), so there is nothing left to review.`,
    };
  }
  return {
    title: "That proposal doesn’t exist",
    description:
      "The link may be mistyped or out of date. Nothing has been selected for you.",
  };
}

/**
 * What the pane shows INSTEAD of a proposal when the deep-link is dead: the outcome,
 * a path onward (the applied item, when there is one), and an EXPLICIT way to review
 * the pending queue instead. Nothing here can approve anything.
 */
function DeadDeepLinkNotice({
  state,
  workspace,
  onShowPending,
  onRetry,
}: Readonly<{
  state: DeepLinkState;
  workspace: string;
  onShowPending: () => void;
  onRetry: () => void;
}>) {
  const { title, description } = deepLinkNotice(state);
  const appliedItemId =
    state.kind === "disposed" &&
    state.status === "applied" &&
    state.targetType === "work_item"
      ? state.targetId
      : null;
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {appliedItemId ? (
            <Link
              to="/w/$workspace/workboard/item/$itemId"
              params={{ workspace, itemId: appliedItemId }}
              className="text-sm font-medium text-primary hover:underline"
            >
              View item →
            </Link>
          ) : null}
          {state.kind === "error" ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onShowPending}>
            Show pending proposals
          </Button>
        </div>
      }
    />
  );
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
  const {
    proposals,
    isLoading,
    error,
    accept,
    reject,
    undo,
    isMutating,
    refetch,
    getProposal,
  } = useProposals({ repository });

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
  const [deepLink, setDeepLink] = useState<DeepLinkState>({ kind: "idle" });
  const [lookupAttempt, setLookupAttempt] = useState(0);
  // The SAME fact as `deepLink.kind !== "idle"`, held in a ref because the effects
  // below run in one commit: a `setDeepLink` from the resolution effect is invisible
  // to the default-selection effect's closure, which would then select the first row
  // anyway — the exact substitution this fix exists to prevent.
  const deepLinkPendingRef = useRef(false);
  const clearDeepLink = (): void => {
    deepLinkPendingRef.current = false;
    setDeepLink({ kind: "idle" });
  };

  // Deep-link RESOLUTION. A requested id that IS pending is selected. One that is
  // NOT pending resolves to an explicit notice — never to the first row: substituting
  // a different proposal is the F6 consent bug, because the substitute arrives with a
  // live Accept button and no indication that it isn't what the link asked for.
  // Gated on `isLoading` so the not-yet-loaded empty list is never read as "absent".
  useEffect(() => {
    if (isLoading) return;
    if (!requestedId || requestedId === appliedRequestRef.current) return;
    appliedRequestRef.current = requestedId;
    if (proposals.some((p) => p.id === requestedId)) {
      clearDeepLink();
      setSelectedId(requestedId);
      return;
    }
    // Absent from the pending list: hold the pane EMPTY and ask what became of it,
    // so the reviewer is told "already accepted" rather than shown a stranger.
    setSelectedId(null);
    deepLinkPendingRef.current = true;
    setDeepLink({ kind: "checking" });
    let cancelled = false;
    void getProposal(requestedId)
      .then((found) => {
        if (cancelled) return;
        setDeepLink(
          found
            ? {
                kind: "disposed",
                status: found.status,
                targetId: found.target_id,
                targetType: found.target_type,
              }
            : { kind: "missing" },
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setDeepLink({
          kind: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [proposals, requestedId, isLoading, getProposal, lookupAttempt]);

  const retryDeepLink = (): void => {
    appliedRequestRef.current = undefined;
    deepLinkPendingRef.current = true;
    setSelectedId(null);
    setDeepLink({ kind: "checking" });
    setLookupAttempt((attempt) => attempt + 1);
  };

  // Default selection — the first row, ONLY when no deep-link is waiting on an
  // answer or reporting a dead one. Never auto-jumps an existing selection (that is
  // what keeps a terminal banner visible after a disposal).
  useEffect(() => {
    if (isLoading || deepLinkPendingRef.current) return;
    setSelectedId((current) => current ?? proposals[0]?.id ?? null);
  }, [proposals, isLoading, deepLink]);

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
  // Picking a row also clears a dead-deep-link notice: THIS is the consenting choice
  // of a different proposal that the auto-fallback used to make on the reviewer's behalf.
  const selectProposal = (id: string): void => {
    if (!isMutating) {
      clearDeepLink();
      setSelectedId(id);
    }
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
  // A dead deep-link keeps the inbox on screen (the list IS the way onward), so its
  // notice outranks the teaching empty state even when nothing is pending.
  if (proposals.length === 0 && selected === null && deepLink.kind === "idle") {
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
          ) : deepLink.kind === "missing" ||
            deepLink.kind === "disposed" ||
            deepLink.kind === "error" ? (
            <DeadDeepLinkNotice
              state={deepLink}
              workspace={workspace}
              onShowPending={clearDeepLink}
              onRetry={retryDeepLink}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
