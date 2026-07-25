import { Link, useParams } from "@tanstack/react-router";

import { Badge, Button, EmptyState, ErrorState } from "@product-suite/ui";

import {
  useMeetingActions,
  type MeetingActionCandidate,
  type MeetingActionsRepository,
  type MeetingPromotionState,
} from "@/data/meeting-actions";

/**
 * Props for {@link MeetingTriageScreen}. Like {@link InboxScreen}, the only prop
 * is the repository SEAM — optional, defaulting to the provider/singleton — so
 * tests can drive the screen against a controlled fixture store.
 */
export interface MeetingTriageScreenProps {
  repository?: MeetingActionsRepository;
}

/** A single loading placeholder row (mirrors the inbox skeleton). */
function SkeletonRow() {
  return <div className="h-16 w-full animate-pulse rounded-lg bg-muted" />;
}

/**
 * How each promotion state reads to a human, and how loudly it shows.
 *
 * `unknown` is a neutral `outline` badge with an honest label: a state from a
 * newer backend must be visibly unrecognized, never silently rendered as one of
 * the states we do understand.
 */
const PROMOTION_STATE_BADGES: Record<
  MeetingPromotionState,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  unpromoted: { label: "Not proposed", variant: "outline" },
  proposal_pending: { label: "Proposal pending", variant: "default" },
  accepted: { label: "Accepted", variant: "secondary" },
  dismissed: { label: "Dismissed", variant: "outline" },
  unknown: { label: "Unknown state", variant: "outline" },
};

/** The confidence badge text, or null when the extractor recorded none. */
function confidenceLabel(confidence: number | null): string | null {
  return confidence === null ? null : `${Math.round(confidence * 100)}% confident`;
}

/**
 * The link a candidate offers, given where it has travelled to.
 *
 * Keyed on the promotion STATE rather than on "has an id", so a candidate whose
 * proposal was dismissed does not advertise a review link for a decision the
 * human already made — and an unrecognized state offers no link at all, because
 * we do not know where it points.
 */
function CandidateLink({
  candidate,
  workspace,
}: Readonly<{ candidate: MeetingActionCandidate; workspace: string }>) {
  if (candidate.promotion_state === "accepted" && candidate.work_item_id !== null) {
    return (
      <Link
        to="/w/$workspace/workboard/item/$itemId"
        params={{ workspace, itemId: candidate.work_item_id }}
        className="text-xs font-medium text-primary hover:underline"
      >
        View work item →
      </Link>
    );
  }
  if (
    candidate.promotion_state === "proposal_pending" &&
    candidate.proposal_id !== null
  ) {
    return (
      <Link
        to="/w/$workspace/inbox"
        params={{ workspace }}
        // `?proposal=<id>` is exactly the parameter InboxScreen reads, so this
        // lands on THIS candidate's proposal rather than the first pending one.
        search={{ proposal: candidate.proposal_id }}
        className="text-xs font-medium text-primary hover:underline"
      >
        Review in Inbox →
      </Link>
    );
  }
  return null;
}

/** One candidate row: what was committed to, and how far it has got. */
function CandidateRow({
  candidate,
  workspace,
}: Readonly<{ candidate: MeetingActionCandidate; workspace: string }>) {
  const badge = PROMOTION_STATE_BADGES[candidate.promotion_state];
  const confidence = confidenceLabel(candidate.confidence);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground">{candidate.text}</p>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {candidate.promotion_reason === null ? null : (
          <span>{candidate.promotion_reason}</span>
        )}
        {confidence === null ? null : <span>{confidence}</span>}
        <CandidateLink candidate={candidate} workspace={workspace} />
      </div>
    </div>
  );
}

/**
 * Meeting triage SCREEN — this org's promoted meeting action items with their
 * TRUE promotion state, so a human can see what a meeting committed to and how
 * far each commitment has actually got toward the board.
 *
 * Mirrors {@link InboxScreen}'s scaffolding: the repository seam via prop →
 * provider → singleton, and the four states (loading skeleton / error / empty /
 * ready) rendered with design-system components only.
 */
export function MeetingTriageScreen({
  repository,
}: Readonly<MeetingTriageScreenProps> = {}) {
  const { workspace } = useParams({ from: "/w/$workspace/meetings/triage" });
  const { candidates, isLoading, error, sync, isSyncing, syncError, isRefetching, refetch } =
    useMeetingActions({ repository });

  // `sync()` clears `isSyncing` the moment the ingest resolves, but the refetch it
  // triggers is still in flight — so the button must stay busy through BOTH phases.
  // Otherwise it reads "Sync now" over a list that is quietly reloading, inviting a
  // second ingest against results the user cannot see yet.
  const isBusy = isSyncing || isRefetching;

  if (isLoading) {
    return (
      <output className="block space-y-2.5" aria-label="Loading meeting action items">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </output>
    );
  }

  if (error !== null) {
    return (
      <ErrorState
        title="Couldn't load meeting action items"
        description={error.message}
        action={
          <Button size="sm" variant="outline" onClick={refetch}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {/* The header — and its Sync button — render for the EMPTY list too. With no
          candidates yet a sync is the only way to get any, so hiding the button
          behind a non-empty list would make the empty state a dead end. */}
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-foreground">Meeting triage</h1>
          <span className="text-sm text-muted-foreground">
            {candidates.length} action {candidates.length === 1 ? "item" : "items"}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          // Disabled in flight so a double-click cannot run a second ingest, and
          // through the follow-up refetch so the reload is never silent.
          disabled={isBusy}
          onClick={() => {
            void sync();
          }}
        >
          {isSyncing ? "Syncing…" : isRefetching ? "Refreshing…" : "Sync now"}
        </Button>
      </header>

      {/* A failed ingest is shown BESIDE the list, never instead of it: nothing was
          written, so replacing what the user is reading with an error screen would
          overstate the damage. */}
      {syncError === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {syncError.message}
        </p>
      )}

      {candidates.length === 0 ? (
        <EmptyState
          title="No meeting action items to triage"
          description="When a meeting produces a promoted action item, it lands here on its way to the board."
        />
      ) : (
        <ul
          className="flex list-none flex-col gap-2.5 p-0"
          aria-label="Meeting action items"
        >
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <CandidateRow candidate={candidate} workspace={workspace} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
