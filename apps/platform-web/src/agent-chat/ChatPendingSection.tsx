import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useNavigate } from "@tanstack/react-router";

import { Button, cn } from "@product-suite/ui";

import { useProposalActions, useProposals, type Proposal } from "@/data/proposals";

import { AcceptStateView } from "./AcceptStateView";

/**
 * A pending-proposal's compact one-line identity for the section row: the
 * operation verb + a human title (the payload's `title`, else a target-type
 * label — never a raw uuid).
 */
function rowIdentity(proposal: Proposal): { verb: string; title: string } {
  const verb = proposal.operation.charAt(0).toUpperCase() + proposal.operation.slice(1);
  const payloadTitle = (proposal.payload as Record<string, unknown>).title;
  const title =
    typeof payloadTitle === "string" && payloadTitle.trim().length > 0
      ? payloadTitle
      : proposal.target_type === "memory"
        ? "Memory note"
        : "Untitled item";
  return { verb, title };
}

/**
 * Scroll the message stream to the inline card that owns this proposal. This works
 * when that card is in the CURRENTLY rendered thread. For a proposal surfaced from
 * a background agent or a DIFFERENT thread (its inline card isn't mounted), the
 * anchor is absent and this is a graceful no-op — the row still disposes in place.
 * KNOWN LIMITATION: jumping across threads would require switching the active
 * thread first; that cross-thread deep-link is a tracked follow-up, not wired here.
 */
function focusInlineCard(proposalId: string): void {
  document
    .getElementById(`proposal-card-${proposalId}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * One row of the Pending section. It runs its OWN {@link useProposalActions} and
 * shares the same {@link AcceptStateView} as the inline card, so accepting here
 * transitions IN PLACE (idle → Applying → Applied ✓ / Needs attention / This item
 * changed) exactly like the primary card — never a navigation. Clicking the title
 * scrolls the stream to the originating inline card (shared `proposalId` anchor).
 */
function PendingRow({
  proposal,
  workspace,
  onResolved,
}: Readonly<{
  proposal: Proposal;
  workspace: string;
  /** Report a TERMINAL disposition (applied / discarded) so the header count drops. */
  onResolved: (proposalId: string) => void;
}>) {
  const navigate = useNavigate();
  const { phase, result, busy, error, accept, reject, reset, refresh } = useProposalActions(
    proposal.id,
    {
      onSettled: (settled) => {
        // Only a terminal outcome leaves the pending set; invalid/stale stay
        // recoverable (and still counted) until the human resolves them.
        if (settled === "rejected" || settled.status === "applied") {
          onResolved(proposal.id);
        }
      },
    },
  );
  const { verb, title } = rowIdentity(proposal);
  const isMemory = proposal.target_type === "memory";

  // A memory proposal has NO workboard item — route its "View" to the memory log,
  // never the work-item route (a memory uuid there is a dead link). Mirrors how
  // ProposalDetail links an applied memory.
  const viewItem = (itemId: string): void => {
    if (isMemory) {
      void navigate({ to: "/w/$workspace/memory", params: { workspace } });
      return;
    }
    void navigate({
      to: "/w/$workspace/workboard/item/$itemId",
      params: { workspace, itemId },
    });
  };

  return (
    <li className="border-b border-border/60 px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => focusInlineCard(proposal.id)}
          className="min-w-0 flex-1 truncate text-left text-xs text-foreground hover:underline"
          title="Jump to this proposal in the chat"
        >
          <span className="text-muted-foreground">{verb}</span>
          <span aria-hidden className="mx-1 text-muted-foreground">
            ·
          </span>
          <span className="font-medium">{title}</span>
        </button>
        {phase === "idle" ? (
          <Button size="xs" disabled={busy} onClick={() => accept()}>
            Accept
          </Button>
        ) : null}
      </div>

      {error ? (
        <output className="mt-1.5 block rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {error}
        </output>
      ) : null}

      {phase === "idle" ? null : (
        <div className="mt-2">
          <AcceptStateView
            phase={phase}
            result={result}
            busy={busy}
            onRetry={() => accept()}
            onEdit={reset}
            onDiscard={() => reject()}
            onRefresh={refresh}
            onApplyAnyway={() => accept()}
            onViewItem={viewItem}
            appliedMessage={isMemory ? "Memory logged." : "Applied."}
            viewItemLabel={isMemory ? "View memory log →" : "View item →"}
          />
        </div>
      )}
    </li>
  );
}

/**
 * The compact **Pending review** section pinned above the chat stream (design
 * wireframe (b)) — a QUIET backstop, never a mini-inbox. It catches proposals from
 * background agents, scrolled-past cards, and other threads; each row disposes in
 * place via the SAME engine + state view as the inline card. Deliberately has no
 * filters, sort, or bulk actions (that is the standalone Inbox's job).
 *
 * Hidden entirely when nothing is pending (no "0 pending" chrome — keep the panel
 * quiet). Shows a scrollable body once the list grows; the header count is the
 * source of truth.
 */
export function ChatPendingSection({ workspace }: Readonly<{ workspace: string }>) {
  const { proposals, isLoading } = useProposals();
  const [expanded, setExpanded] = useState(true);
  // Rows that reached a TERMINAL disposition (applied/discarded) this session —
  // subtracted from the header count without unmounting the row (so its in-place
  // "Applied ✓" survives), since the list itself does not auto-refetch on accept.
  const [resolved, setResolved] = useState<ReadonlySet<string>>(() => new Set());

  const markResolved = (proposalId: string): void =>
    setResolved((prev) => {
      if (prev.has(proposalId)) return prev;
      const next = new Set(prev);
      next.add(proposalId);
      return next;
    });

  // Empty / still-loading: render nothing (the section is a backstop, not chrome).
  if (isLoading || proposals.length === 0) return null;

  const pendingCount = proposals.reduce(
    (count, proposal) => (resolved.has(proposal.id) ? count : count + 1),
    0,
  );

  return (
    <section
      aria-label="Pending review"
      className="shrink-0 border-b border-border bg-muted/30"
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        <span>Pending review</span>
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
          {pendingCount}
        </span>
      </button>

      {expanded ? (
        <ul className={cn("m-0 max-h-64 list-none overflow-y-auto p-0")}>
          {proposals.map((proposal) => (
            <PendingRow
              key={proposal.id}
              proposal={proposal}
              workspace={workspace}
              onResolved={markResolved}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
