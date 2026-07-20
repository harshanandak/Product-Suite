import { useNavigate } from "@tanstack/react-router";

import { Button, cn } from "@product-suite/ui";

import { useProposalActions, type AcceptResult } from "@/data/proposals";

import { AcceptStateView } from "./AcceptStateView";
import type { ProposalCardData } from "./proposal-card-data";

/** The state pill in the card header — mirrors the accept lifecycle, no navigation. */
function statusPill(
  phase: "idle" | "applying" | "settled" | "rejected",
  result: AcceptResult | null,
): { label: string; tone: "muted" | "primary" | "destructive" } {
  if (phase === "applying") return { label: "Applying…", tone: "primary" };
  if (phase === "rejected") return { label: "Discarded", tone: "muted" };
  if (phase === "settled" && result) {
    switch (result.status) {
      case "applied":
        return { label: "Applied ✓", tone: "primary" };
      case "invalid":
      case "failed":
        return { label: "Needs attention", tone: "destructive" };
      case "stale":
        return { label: "This item changed", tone: "primary" };
      case "not_found":
        return { label: "Unavailable", tone: "muted" };
      case "not_pending":
        return { label: "Already handled", tone: "muted" };
    }
  }
  return { label: "Pending review", tone: "muted" };
}

/**
 * The proposal moment, now ACTIONABLE IN PLACE (inline-proposal-ux design): a
 * card in the message stream when a `propose_*` tool completes — operation
 * badge, proposed title, a short summary, and inline Accept / Edit / Discard.
 * Accepting transitions the card's own footer through Applying → Applied ✓ /
 * Needs attention / This item changed via the shared {@link AcceptStateView} +
 * {@link useProposalActions} — ZERO navigation. `accept` needs only the
 * `proposalId` (the payload is server-side). "Edit" opens the full field editor
 * in the inbox (inline field-editing is a deferred follow-up); "View item" after
 * an applied write is the only, optional, after-the-fact navigation.
 */
export function ProposalCard({
  data,
  workspace,
}: Readonly<{ data: ProposalCardData; workspace: string }>) {
  const isCreate = data.operation === "create";
  const navigate = useNavigate();
  const { phase, result, busy, error, accept, reject, reset } = useProposalActions(
    data.proposalId,
  );

  const pill = statusPill(phase, result);

  const openInInbox = (): void => {
    void navigate({
      to: "/w/$workspace/inbox",
      params: { workspace },
      search: { proposal: data.proposalId },
    });
  };
  const viewItem = (itemId: string): void => {
    void navigate({
      to: "/w/$workspace/workboard/item/$itemId",
      params: { workspace, itemId },
    });
  };

  return (
    <div
      id={`proposal-card-${data.proposalId}`}
      className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-xs font-medium",
            isCreate
              ? "bg-primary/10 text-primary"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {isCreate ? "Create" : "Update"}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs",
            pill.tone === "primary"
              ? "bg-primary/10 text-primary"
              : pill.tone === "destructive"
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground",
          )}
        >
          {pill.label}
        </span>
      </div>

      <p className="mt-2 font-medium text-foreground">{data.title}</p>
      {data.summary ? (
        <p className="mt-1 line-clamp-3 text-muted-foreground">{data.summary}</p>
      ) : null}

      {/* A failed discard is surfaced VISIBLY (never a false success). */}
      {error ? (
        <output className="mt-2 block rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </output>
      ) : null}

      {phase === "idle" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => accept()}>
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={openInInbox}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => reject()}>
            Discard
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <AcceptStateView
            phase={phase}
            result={result}
            busy={busy}
            onRetry={() => accept()}
            onEdit={reset}
            onDiscard={() => reject()}
            onRefresh={reset}
            onApplyAnyway={() => accept()}
            onViewItem={viewItem}
          />
        </div>
      )}
    </div>
  );
}
