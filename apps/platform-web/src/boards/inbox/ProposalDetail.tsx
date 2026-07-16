import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Link } from "@tanstack/react-router";

import { Badge, Button, Textarea, cn } from "@product-suite/ui";

import { useMemories, type MemoryRow } from "@/data/memories";
import { useProposals, type AcceptResult, type Proposal } from "@/data/proposals";
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
import { RuleAttributionBadge } from "./RuleAttributionBadge";
import { RuleProposalSurface, type RuleStrength } from "./RuleProposalSurface";

/** Skippable, one-tap reject reasons for a work-item/memory proposal. */
const REJECT_CHIPS = ["wrong target", "bad data", "not needed"] as const;

/** Rule-shaped reject reasons — a learned rule fails in different ways than a work item. */
const RULE_REJECT_CHIPS = ["too broad", "not what I meant", "don't make this a rule"] as const;

/** Props for {@link ProposalDetail}. */
export interface ProposalDetailProps {
  proposal: Proposal;
  /**
   * Accept mutation from `useProposals` (returns the surfaced outcome). An optional
   * `editedPayload` carries a human's gold-label correction (P1b): the API applies
   * `edited_payload ?? payload` as a WHOLESALE replace, so it must be the FULL merged
   * payload (never a partial) — e.g. a rule's reviewer-chosen `{ ...payload, enforcement, pinned }`.
   */
  accept: (id: string, editedPayload?: Record<string, unknown>) => Promise<AcceptResult>;
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
  chips,
  reason,
  setReason,
  isMutating,
  onReject,
  onCancel,
}: Readonly<{
  chips: readonly string[];
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
        {chips.map((chip) => (
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
  disableAccept,
  acceptLabel,
  acceptHint,
  onAccept,
  onStartReject,
}: Readonly<{
  isMutating: boolean;
  disableAccept: boolean;
  acceptLabel: string;
  acceptHint: string | null;
  onAccept: () => void;
  onStartReject: () => void;
}>) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className={cn(
            "bg-success text-success-foreground hover:bg-success/90",
            "focus-visible:ring-success/40",
          )}
          // Disable while a mutation is in flight OR while a named memory target is still
          // resolving — never apply a supersede/retract/defer against a stale/unknown target.
          disabled={isMutating || disableAccept}
          onClick={onAccept}
        >
          {acceptLabel}
        </Button>
        <Button size="sm" variant="destructive" disabled={isMutating} onClick={onStartReject}>
          Reject
        </Button>
      </div>
      {acceptHint ? (
        <output className="text-xs text-muted-foreground">{acceptHint}</output>
      ) : null}
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
  isMemory,
  isRule,
  operation,
  rejecting,
  reason,
  setReason,
  isMutating,
  disableAccept,
  acceptHint,
  onAccept,
  onReject,
  onStartReject,
  onCancelReject,
}: Readonly<{
  status: DisposeStatus;
  workspace: string;
  isMemory: boolean;
  isRule: boolean;
  operation: Proposal["operation"];
  rejecting: boolean;
  reason: string;
  setReason: (reason: string) => void;
  isMutating: boolean;
  disableAccept: boolean;
  acceptHint: string | null;
  onAccept: () => void;
  onReject: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
}>) {
  if (status.kind === "applied") {
    // A memory has no workboard item — link to the decision log, never the
    // work-item route (a memory uuid there is a dead link), and report the ACTUAL
    // operation applied (logged / updated / retracted / deferred).
    if (isMemory) {
      return (
        <StatusBanner tone="primary">
          {memoryAppliedMessage(operation, isRule)}{" "}
          <Link
            to="/w/$workspace/memory"
            params={{ workspace }}
            className="font-medium text-primary hover:underline"
          >
            View memory log →
          </Link>
        </StatusBanner>
      );
    }
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
        chips={isRule ? RULE_REJECT_CHIPS : REJECT_CHIPS}
        reason={reason}
        setReason={setReason}
        isMutating={isMutating}
        onReject={onReject}
        onCancel={onCancelReject}
      />
    );
  }
  return (
    <ActionButtons
      isMutating={isMutating}
      disableAccept={disableAccept}
      acceptLabel={isRule ? "Accept rule" : "Accept"}
      acceptHint={acceptHint}
      onAccept={onAccept}
      onStartReject={onStartReject}
    />
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
/** The load state of a named memory target (supersede/retract/defer). `idle` = nothing to fetch. */
type MemoryTargetState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; memory: MemoryRow }
  | { kind: "error" };

/**
 * Why Accept is blocked for a memory op whose target is still resolving — or null when
 * it isn't blocked. Loading/error both gate Accept so a supersede/retract/defer can never
 * be applied against a stale or unknown target.
 */
function acceptBlockedMessage(state: MemoryTargetState): string | null {
  if (state.kind === "loading") return "Loading the target memory…";
  if (state.kind === "error") return "Couldn't load the target memory — refresh to try again.";
  return null;
}

/** The applied-banner wording for a memory op — each operation reports what it actually did. */
function memoryAppliedMessage(operation: Proposal["operation"], isRule: boolean): string {
  if (operation === "supersede") return "Memory updated.";
  if (operation === "retract") return "Memory retracted.";
  if (operation === "defer") return "Memory deferred.";
  // create — a learned rule reads as a saved rule; every other memory "Memory logged.".
  return isRule
    ? "Rule saved — the agent follows it from now on."
    : "Memory logged.";
}

export function ProposalDetail({
  proposal,
  accept,
  reject,
  isMutating,
  workspace,
}: Readonly<ProposalDetailProps>) {
  const isMemory = proposal.target_type === "memory";
  // A reflection-authored rule proposal — it gets the applicability/evidence/strength
  // surface, and its accept folds the reviewer's strength into a full merged edited_payload.
  const isRuleProposal =
    isMemory && (proposal.payload as Record<string, unknown>).kind === "rule";

  // The reviewer's chosen strength for a rule (default from the payload). `touched`
  // gates whether accept sends an edited_payload at all: an untouched rule accepts
  // as-is (edited_payload stays null — the agent's original is the gold label), while
  // any toggle folds the FULL merged payload so kind+title are never dropped.
  const [ruleStrength, setRuleStrength] = useState<RuleStrength>(() => {
    const payload = proposal.payload as Record<string, unknown>;
    return {
      enforcement: payload.enforcement === "hard" ? "hard" : "advisory",
      pinned: payload.pinned === true,
    };
  });
  const ruleStrengthTouched = useRef(false);
  const onStrengthChange = useCallback((next: RuleStrength) => {
    ruleStrengthTouched.current = true;
    setRuleStrength(next);
  }, []);

  // The work-item update diff reads the target's CURRENT values from the loaded list.
  const { items } = useWorkItems();
  const workItemTarget =
    isMemory || proposal.target_id === null
      ? undefined
      : items.find((item) => item.id === proposal.target_id);

  // Every non-create memory op (supersede/retract/defer) NAMES a target, so fetch it
  // by id (it may not be in any loaded list) — a supersede needs it for the
  // current → proposed diff, and retract/defer need its TITLE in the header so the
  // reviewer never approves a destructive op identified only by a raw uuid.
  const { get: getMemory } = useMemories();
  // A supersede/retract/defer NAMES a target memory the reviewer must see before acting.
  // Track it as a small state machine so the pane can (a) NEVER show a previous target's
  // title/diff while a new one loads — we clear to `loading` on every target change — and
  // (b) disable Accept until the requested target actually loads. `idle` = no target to
  // fetch (create / non-memory), so nothing is gated.
  const [memoryTargetState, setMemoryTargetState] = useState<MemoryTargetState>({
    kind: "idle",
  });
  useEffect(() => {
    if (!isMemory || proposal.operation === "create" || !proposal.target_id) {
      setMemoryTargetState({ kind: "idle" });
      return;
    }
    // Clear the previous target IMMEDIATELY (→ loading): a stale title/diff must never
    // render, and Accept must not stay enabled, while the new target is in flight.
    setMemoryTargetState({ kind: "loading" });
    let cancelled = false;
    void getMemory(proposal.target_id)
      .then((detail) => {
        if (!cancelled) setMemoryTargetState({ kind: "ready", memory: detail.memory });
      })
      .catch(() => {
        if (!cancelled) setMemoryTargetState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [isMemory, proposal.operation, proposal.target_id, getMemory]);
  const memoryTarget =
    memoryTargetState.kind === "ready" ? memoryTargetState.memory : undefined;
  // Block Accept while a named memory target is still loading or failed to load.
  const acceptHint = acceptBlockedMessage(memoryTargetState);
  const disableAccept = acceptHint !== null;

  // The rules active during the run that authored THIS proposal — provenance for the
  // "Rules active during this run" badge (only a work-item proposal shows it). Fetched
  // via a small cancellable effect, mirroring the memory-target fetch above; a failed
  // provenance read is non-blocking (the badge simply stays empty).
  const { activeRules } = useProposals();
  const [ruleTitles, setRuleTitles] = useState<readonly string[]>([]);
  useEffect(() => {
    if (isMemory) {
      setRuleTitles([]);
      return;
    }
    let cancelled = false;
    void activeRules(proposal.id)
      .then((rules) => {
        if (!cancelled) setRuleTitles(rules.map((rule) => rule.title));
      })
      .catch(() => {
        if (!cancelled) setRuleTitles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isMemory, proposal.id, activeRules]);

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
    // When the reviewer changed a rule's strength, fold it into the FULL merged
    // payload — the API applies `edited_payload ?? payload` as a wholesale replace and
    // re-validates (kind+title required), so a partial `{enforcement,pinned}` would drop
    // those and terminally fail the proposal. An untouched proposal accepts as-is.
    const editedPayload =
      isRuleProposal && ruleStrengthTouched.current
        ? {
            ...(proposal.payload as Record<string, unknown>),
            enforcement: ruleStrength.enforcement,
            pinned: ruleStrength.pinned,
          }
        : undefined;
    void accept(proposal.id, editedPayload)
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
      {/* The decision surface — what `accept` applies — branches on target_type.
          A rule gets its own applicability/evidence/strength surface. */}
      {isRuleProposal ? (
        <RuleProposalSurface proposal={proposal} onStrengthChange={onStrengthChange} />
      ) : isMemory ? (
        <MemorySurface proposal={proposal} target={memoryTarget} />
      ) : (
        <>
          <WorkItemSurface proposal={proposal} target={workItemTarget} workspace={workspace} />
          {/* Rules active during the authoring run — provenance, not causation.
              Fed by the run→rule-attribution join (empty renders nothing). */}
          <RuleAttributionBadge ruleTitles={ruleTitles} />
        </>
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
        isMemory={isMemory}
        isRule={isRuleProposal}
        operation={proposal.operation}
        rejecting={rejecting}
        reason={reason}
        setReason={setReason}
        isMutating={isMutating}
        disableAccept={disableAccept}
        acceptHint={acceptHint}
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
