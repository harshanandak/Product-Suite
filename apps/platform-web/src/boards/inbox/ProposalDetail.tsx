import { useState } from "react";

import { Link } from "@tanstack/react-router";

import { Badge, Button, Textarea, cn } from "@product-suite/ui";

import type { AcceptResult, Proposal } from "@/data/proposals";
import { useWorkItems } from "@/data/work-items";

import {
  buildFieldRows,
  describeOperation,
  formatConfidence,
  formatCreatedAt,
} from "./field-diff";

/** Skippable, one-tap reject reasons (the reason itself stays optional). */
const REJECT_CHIPS = ["wrong target", "bad data", "not needed"] as const;

/** Props for {@link ProposalDetail}. */
export interface ProposalDetailProps {
  proposal: Proposal;
  /** Accept mutation from `useProposals` (returns the surfaced outcome). */
  accept: (id: string) => Promise<AcceptResult>;
  /** Reject mutation from `useProposals`. */
  reject: (id: string, reason?: string) => Promise<void>;
  /** True while an accept/reject is in flight (disables the actions). */
  isMutating: boolean;
  /** Active workspace slug — used to link to the target/applied work item. */
  workspace: string;
}

/** The terminal state a disposition leaves the pane in (survives list refetch). */
type DisposeStatus =
  | { kind: "idle" }
  | { kind: "applied"; itemId: string }
  | { kind: "rejected" }
  | { kind: "stale" }
  | { kind: "invalid" };

/**
 * The decision surface — *what will actually change* (Agent Slice PR3, Task 3).
 * Layered top-down: (a) the operation sentence + confidence, (b) the rationale
 * (visually primary), (c) the field table as ROWS — `field | value` for a create,
 * `field | current → proposed` (changed fields only) for an update, the target's
 * current values fetched via the work-items hook. The diff shows EXACTLY what
 * `accept` applies — a wrong diff is the one unforgivable bug, so it flows from
 * the tested {@link buildFieldRows}. Below: Accept (green) and Reject (red, with a
 * skippable optional reason), provenance fine-print, and a collapsible raw payload.
 *
 * Rows are DIVs (not a JSON blob) precisely so PR3.5 can swap a value cell for an
 * edit input (edit-before-accept) without reshaping this surface.
 */
export function ProposalDetail({
  proposal,
  accept,
  reject,
  isMutating,
  workspace,
}: Readonly<ProposalDetailProps>) {
  // The target's current values feed the update diff + the operation sentence.
  const { items } = useWorkItems();
  const target =
    proposal.target_id === null
      ? undefined
      : items.find((item) => item.id === proposal.target_id);

  const rows = buildFieldRows(proposal, target);
  const sentence = describeOperation(proposal, target, rows.length);
  const confidence = formatConfidence(proposal.confidence);
  const isUpdate = proposal.operation === "update";

  const [status, setStatus] = useState<DisposeStatus>({ kind: "idle" });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  // Transport failure (5xx/401/network) surfaced VISIBLY. The repository throws on
  // these — without a catch a failed accept/reject is an unhandled rejection with
  // the pane sitting idle (an invisible failure). We mirror WorkboardScreen's
  // aria-live error surfacing so the user always sees a failed disposition.
  const [error, setError] = useState<string | null>(null);

  const onAccept = (): void => {
    // The hook refetches the list on settle; we branch on the SURFACED outcome so
    // a stale/invalid disposition is never a silent failure. A THROWN error
    // (transport 5xx/401/network) surfaces as a visible banner, never silence.
    setError(null);
    void accept(proposal.id)
      .then((result) => {
        setStatus(
          result.outcome === "applied"
            ? { kind: "applied", itemId: result.item.id }
            : result.outcome === "stale"
              ? { kind: "stale" }
              : { kind: "invalid" },
        );
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't accept this proposal. Please try again.",
        );
      });
  };

  const onReject = (): void => {
    const trimmed = reason.trim();
    // Only close the form + mark rejected on SUCCESS. On a thrown error we keep
    // the form open with the reason intact (never discard it) and surface the
    // failure — a failed reject must never read as success.
    setError(null);
    void reject(proposal.id, trimmed === "" ? undefined : trimmed)
      .then(() => {
        setStatus({ kind: "rejected" });
        setRejecting(false);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't reject this proposal. Please try again.",
        );
      });
  };

  return (
    <section className="flex flex-col gap-5">
      {/* (a) operation sentence + confidence + target link */}
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">{sentence}</h2>
          {confidence ? (
            <Badge
              variant="outline"
              className="flex-none font-mono text-[11px] text-muted-foreground"
              title="Model confidence"
            >
              {confidence}
            </Badge>
          ) : null}
        </div>
        {proposal.target_id ? (
          <Link
            to="/w/$workspace/workboard/item/$itemId"
            params={{ workspace, itemId: proposal.target_id }}
            className="w-fit text-xs text-primary hover:underline"
          >
            View target item →
          </Link>
        ) : null}
      </header>

      {/* (b) rationale — visually primary */}
      {proposal.rationale ? (
        <p className="text-sm leading-relaxed text-foreground">
          {proposal.rationale}
        </p>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          No rationale provided.
        </p>
      )}

      {/* (c) field rows — never a JSON blob (PR3.5 edit extension point) */}
      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isUpdate ? "Changes" : "Fields"}
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No field changes.
          </p>
        ) : (
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div
                key={row.field}
                className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-3 px-3 py-2 text-sm"
              >
                <dt className="truncate font-mono text-xs text-muted-foreground">
                  {row.field}
                </dt>
                <dd className="min-w-0">
                  {row.current === undefined ? (
                    <span className="break-words text-foreground">
                      {row.proposed}
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">{row.current}</span>
                      <span aria-hidden className="text-muted-foreground">
                        →
                      </span>
                      <span className="font-medium text-foreground">
                        {row.proposed}
                      </span>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* Transport-error banner — a failed accept/reject is NEVER silent. */}
      {error ? (
        <div
          role="status"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {/* Actions / terminal disposition status */}
      {status.kind === "applied" ? (
        <div
          role="status"
          className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-foreground"
        >
          Applied.{" "}
          <Link
            to="/w/$workspace/workboard/item/$itemId"
            params={{ workspace, itemId: status.itemId }}
            className="font-medium text-primary hover:underline"
          >
            View item →
          </Link>
        </div>
      ) : status.kind === "rejected" ? (
        <div
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          Rejected.
        </div>
      ) : status.kind === "stale" ? (
        <div
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          This proposal is no longer pending — the list has been refreshed.
        </div>
      ) : status.kind === "invalid" ? (
        <div
          role="status"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground"
        >
          The server rejected this proposal as invalid.
        </div>
      ) : rejecting ? (
        <div className="flex flex-col gap-2.5 rounded-md border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Reason (optional)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REJECT_CHIPS.map((chip) => (
              <Button
                key={chip}
                type="button"
                size="xs"
                variant={reason === chip ? "default" : "outline"}
                onClick={() => setReason(chip)}
              >
                {chip}
              </Button>
            ))}
          </div>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Add a note (optional)"
            rows={2}
            aria-label="Rejection reason"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={isMutating}
              onClick={onReject}
            >
              Reject proposal
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className={cn(
              "bg-success text-success-foreground hover:bg-success/90",
              "focus-visible:ring-success/40",
            )}
            disabled={isMutating}
            onClick={onAccept}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={isMutating}
            onClick={() => setRejecting(true)}
          >
            Reject
          </Button>
        </div>
      )}

      {/* provenance — fine print */}
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <div className="flex gap-1">
          <dt>model</dt>
          <dd className="font-mono text-foreground/70">{proposal.model_id}</dd>
        </div>
        <div className="flex gap-1">
          <dt>run</dt>
          <dd className="font-mono text-foreground/70">{proposal.run_id}</dd>
        </div>
        <div className="flex gap-1">
          <dt>created</dt>
          <dd>{formatCreatedAt(proposal.created_at)}</dd>
        </div>
      </dl>

      {/* collapsible raw payload — a secondary, never the primary surface */}
      <div>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={rawOpen}
          onClick={() => setRawOpen((open) => !open)}
        >
          {rawOpen ? "Hide" : "Show"} raw payload
        </button>
        {rawOpen ? (
          <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground">
            {JSON.stringify(proposal.payload, null, 2)}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
