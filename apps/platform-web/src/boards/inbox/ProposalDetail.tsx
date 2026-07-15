import { type ReactNode, useEffect, useState } from "react";

import { Link } from "@tanstack/react-router";

import { Badge, Button, Textarea, cn } from "@product-suite/ui";

import { useMemories, type MemoryRow } from "@/data/memories";
import type { AcceptResult, Proposal } from "@/data/proposals";
import { useWorkItems, type WorkItem } from "@/data/work-items";

import {
  buildFieldRows,
  describeOperation,
  formatConfidence,
  formatCreatedAt,
} from "./field-diff";
import {
  buildMemoryCreateRows,
  buildMemoryDeferRows,
  buildMemorySupersedeRows,
  describeMemoryOperation,
  memoryBody,
  memoryChangeReason,
} from "./memory-diff";

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

/** Map an accept outcome to the terminal disposition it leaves the pane in. */
function outcomeToStatus(result: AcceptResult): DisposeStatus {
  if (result.outcome === "applied") return { kind: "applied", itemId: result.item.id };
  if (result.outcome === "stale") return { kind: "stale" };
  return { kind: "invalid" };
}

/** Border/surface classes per banner tone. */
const BANNER_TONE = {
  primary: "border-primary/40 bg-primary/5 text-foreground",
  destructive: "border-destructive/40 bg-destructive/5 text-foreground",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

/** A status disposition banner (`<output>` = implicit role=status) — the four
 *  terminal states share this shell. */
function StatusBanner({
  tone,
  children,
}: Readonly<{ tone: keyof typeof BANNER_TONE; children: ReactNode }>) {
  return (
    <output className={cn("block rounded-md border px-3 py-2 text-sm", BANNER_TONE[tone])}>
      {children}
    </output>
  );
}

/** The reject sub-form: skippable reason chips + note + confirm/cancel. */
function RejectForm({
  reason,
  setReason,
  isMutating,
  onReject,
  onCancel,
}: Readonly<{
  reason: string;
  setReason: (reason: string) => void;
  isMutating: boolean;
  onReject: () => void;
  onCancel: () => void;
}>) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">Reason (optional)</p>
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
        <Button size="sm" variant="destructive" disabled={isMutating} onClick={onReject}>
          Reject proposal
        </Button>
        <Button size="sm" variant="ghost" disabled={isMutating} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Default Accept / Reject affordance (before any disposition). */
function ActionButtons({
  isMutating,
  onAccept,
  onStartReject,
}: Readonly<{ isMutating: boolean; onAccept: () => void; onStartReject: () => void }>) {
  return (
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
      <Button size="sm" variant="destructive" disabled={isMutating} onClick={onStartReject}>
        Reject
      </Button>
    </div>
  );
}

/**
 * The disposition region — terminal banner, reject form, or default actions.
 * Flat early-returns (not a nested ternary chain) so this stays well under the
 * cognitive-complexity limit that a five-way inline ternary tripped.
 */
function DispositionBlock({
  status,
  workspace,
  rejecting,
  reason,
  setReason,
  isMutating,
  onAccept,
  onReject,
  onStartReject,
  onCancelReject,
}: Readonly<{
  status: DisposeStatus;
  workspace: string;
  rejecting: boolean;
  reason: string;
  setReason: (reason: string) => void;
  isMutating: boolean;
  onAccept: () => void;
  onReject: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
}>) {
  if (status.kind === "applied") {
    return (
      <StatusBanner tone="primary">
        Applied.{" "}
        <Link
          to="/w/$workspace/workboard/item/$itemId"
          params={{ workspace, itemId: status.itemId }}
          className="font-medium text-primary hover:underline"
        >
          View item →
        </Link>
      </StatusBanner>
    );
  }
  if (status.kind === "rejected") return <StatusBanner tone="muted">Rejected.</StatusBanner>;
  if (status.kind === "stale") {
    return (
      <StatusBanner tone="muted">
        This proposal is no longer pending — the list has been refreshed.
      </StatusBanner>
    );
  }
  if (status.kind === "invalid") {
    return (
      <StatusBanner tone="destructive">
        The server rejected this proposal as invalid.
      </StatusBanner>
    );
  }
  if (rejecting) {
    return (
      <RejectForm
        reason={reason}
        setReason={setReason}
        isMutating={isMutating}
        onReject={onReject}
        onCancel={onCancelReject}
      />
    );
  }
  return (
    <ActionButtons isMutating={isMutating} onAccept={onAccept} onStartReject={onStartReject} />
  );
}

/** The muted confidence badge shared by both decision surfaces (hidden when null). */
function ConfidenceBadge({ confidence }: Readonly<{ confidence: string | null }>) {
  if (!confidence) return null;
  return (
    <Badge
      variant="outline"
      className="flex-none font-mono text-[11px] text-muted-foreground"
      title="Model confidence"
    >
      {confidence}
    </Badge>
  );
}

/** The primary rationale paragraph (or a muted placeholder) shared by both surfaces. */
function Rationale({ text }: Readonly<{ text: string | null }>) {
  if (text) {
    return <p className="text-sm leading-relaxed text-foreground">{text}</p>;
  }
  return <p className="text-sm italic text-muted-foreground">No rationale provided.</p>;
}

/**
 * The WORK-ITEM decision surface (unchanged from PR3): operation sentence +
 * confidence + target link, the rationale, and the field-diff table (`field | value`
 * for a create, `field | current → proposed` for the changed fields of an update).
 */
function WorkItemSurface({
  proposal,
  target,
  workspace,
}: Readonly<{ proposal: Proposal; target: WorkItem | undefined; workspace: string }>) {
  const rows = buildFieldRows(proposal, target);
  const sentence = describeOperation(proposal, target, rows.length);
  const confidence = formatConfidence(proposal.confidence);
  const isUpdate = proposal.operation === "update";

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">{sentence}</h2>
          <ConfidenceBadge confidence={confidence} />
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

      <Rationale text={proposal.rationale} />

      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isUpdate ? "Changes" : "Fields"}
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">No field changes.</p>
        ) : (
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div
                key={row.field}
                className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-3 px-3 py-2 text-sm"
              >
                <dt className="truncate font-mono text-xs text-muted-foreground">{row.field}</dt>
                <dd className="min-w-0">
                  {row.current === undefined ? (
                    <span className="break-words text-foreground">{row.proposed}</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground">{row.current}</span>
                      <span aria-hidden className="text-muted-foreground">
                        →
                      </span>
                      <span className="font-medium text-foreground">{row.proposed}</span>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </>
  );
}

/** A labelled attribute row (`label | value`) on the memory surface. */
function MemoryAttrRows({
  rows,
}: Readonly<{ rows: { label: string; value: string }[] }>) {
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-3 px-3 py-2 text-sm"
        >
          <dt className="truncate font-mono text-xs text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The supersede `current → proposed` diff table for the overridden memory fields. */
function MemorySupersedeDiff({
  proposal,
  target,
}: Readonly<{ proposal: Proposal; target: MemoryRow | undefined }>) {
  const rows = buildMemorySupersedeRows(proposal, target);
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-sm text-muted-foreground">No field changes.</p>;
  }
  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div
          key={row.field}
          className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-3 px-3 py-2 text-sm"
        >
          <dt className="truncate font-mono text-xs text-muted-foreground">{row.field}</dt>
          <dd className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">{row.current}</span>
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
              <span className="font-medium text-foreground">{row.proposed}</span>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The MEMORY decision surface (P1b): the operation sentence, the memory BODY as the
 * visually primary block (the rationale being logged), then the operation-specific
 * detail — a create's kind/topics/scope rows, a supersede's change_reason +
 * current→proposed diff (target fetched via the memories adapter), or a defer's
 * waiting-on/review-after context. Accept / Reject are the SHARED disposition below.
 */
function MemorySurface({
  proposal,
  target,
}: Readonly<{ proposal: Proposal; target: MemoryRow | undefined }>) {
  const isSupersede = proposal.operation === "supersede";
  const changedCount = isSupersede
    ? buildMemorySupersedeRows(proposal, target).length
    : 0;
  const sentence = describeMemoryOperation(proposal, target, changedCount);
  const confidence = formatConfidence(proposal.confidence);
  const body = memoryBody(proposal);
  const changeReason = memoryChangeReason(proposal);

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{sentence}</h2>
        <ConfidenceBadge confidence={confidence} />
      </header>

      {/* the memory body (the content being logged) — visually primary */}
      {body ? (
        <p className="text-sm leading-relaxed text-foreground">{body}</p>
      ) : proposal.operation === "create" || isSupersede ? (
        <p className="text-sm italic text-muted-foreground">No body provided.</p>
      ) : null}

      {/* the agent's rationale for proposing — secondary */}
      {proposal.rationale ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium">Why proposed: </span>
          {proposal.rationale}
        </p>
      ) : null}

      {isSupersede && changeReason ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          <span className="font-medium">Change reason: </span>
          {changeReason}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isSupersede ? "Changes" : "Details"}
        </div>
        {isSupersede ? (
          <MemorySupersedeDiff proposal={proposal} target={target} />
        ) : proposal.operation === "create" ? (
          <MemoryAttrRows rows={buildMemoryCreateRows(proposal)} />
        ) : proposal.operation === "defer" ? (
          <MemoryAttrRows rows={buildMemoryDeferRows(proposal)} />
        ) : (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            Retract this memory (it will no longer be surfaced).
          </p>
        )}
      </div>
    </>
  );
}

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
  const isMemory = proposal.target_type === "memory";

  // The work-item update diff reads the target's CURRENT values from the loaded list.
  const { items } = useWorkItems();
  const workItemTarget =
    isMemory || proposal.target_id === null
      ? undefined
      : items.find((item) => item.id === proposal.target_id);

  // A memory supersede shows current → proposed, so fetch the target memory by id
  // (it may not be in any loaded list). Only fetched for a memory supersede.
  const { get: getMemory } = useMemories();
  const [memoryTarget, setMemoryTarget] = useState<MemoryRow | undefined>(undefined);
  useEffect(() => {
    if (!isMemory || proposal.operation !== "supersede" || !proposal.target_id) {
      setMemoryTarget(undefined);
      return;
    }
    let cancelled = false;
    void getMemory(proposal.target_id)
      .then((detail) => {
        if (!cancelled) setMemoryTarget(detail.memory);
      })
      .catch(() => {
        // A failed target fetch is non-fatal: the diff falls back to an em-dash
        // current (buildMemorySupersedeRows), never a blank or a crashed pane.
        if (!cancelled) setMemoryTarget(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [isMemory, proposal.operation, proposal.target_id, getMemory]);

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
        setStatus(outcomeToStatus(result));
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
      {/* The decision surface — what `accept` applies — branches on target_type. */}
      {isMemory ? (
        <MemorySurface proposal={proposal} target={memoryTarget} />
      ) : (
        <WorkItemSurface proposal={proposal} target={workItemTarget} workspace={workspace} />
      )}

      {/* Transport-error banner — a failed accept/reject is NEVER silent. */}
      {error ? (
        <output className="block rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </output>
      ) : null}

      {/* Actions / terminal disposition status */}
      <DispositionBlock
        status={status}
        workspace={workspace}
        rejecting={rejecting}
        reason={reason}
        setReason={setReason}
        isMutating={isMutating}
        onAccept={onAccept}
        onReject={onReject}
        onStartReject={() => setRejecting(true)}
        onCancelReject={() => {
          setRejecting(false);
          setReason("");
          // Clear any prior failed-reject banner — nothing is in flight.
          setError(null);
        }}
      />

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
