import type { ReactNode } from "react";

import { Button, cn } from "@product-suite/ui";

import type { AcceptResult } from "@/data/proposals";

/**
 * The lifecycle phase of an accept action, independent of WHERE it renders. The
 * host (inline chat card, Pending row, or the standalone inbox) owns the `idle`
 * affordance (Accept/Edit/Discard); this view renders everything AFTER the human
 * clicks Accept — the optimistic `applying` spinner and every terminal outcome.
 */
export type AcceptPhase = "idle" | "applying" | "settled" | "rejected";

/**
 * `AcceptStateView` — the ONE shared, placement-agnostic renderer for an accept
 * outcome (extracted from the inbox's former private banners so the inline chat
 * card, the Pending section, and the standalone inbox all show identical UX).
 * It embodies the moat's trust promise: an accept is never a silent no-op —
 * every result is legible and recoverable.
 *
 * - `applying`   → optimistic "Applying your change…" (accept feels instant).
 * - `applied`    → "Applied ✓" + an optional "View item →" (the only navigation).
 * - `invalid`/`failed` → "Needs attention": the server's plain-language `message`.
 *   When `retryable` → Retry / Edit / Discard (the proposal is still recoverable).
 *   When NOT `retryable` → TERMINAL: Discard/acknowledge ONLY (Retry+Edit are dead
 *   ends, so we never offer them and never imply the proposal is still fixable).
 * - `stale`      → "This item changed" + Refresh / Discard / Apply-anyway
 *   (never a silent clobber). Apply-anyway is a best-effort override, not a promise.
 * - `not_found`/`not_pending` → a minimal acknowledgement (nothing to act on).
 * - `rejected`   → a muted "Discarded." terminal.
 */
export interface AcceptStateViewProps {
  phase: AcceptPhase;
  /** The settled envelope; required when `phase === "settled"`, else ignored. */
  result: AcceptResult | null;
  /** True while any action (accept/retry/discard/refresh/apply-anyway) is in flight. */
  busy: boolean;
  onRetry: () => void;
  /** "Edit" on the needs-attention state — hands control back to the host's idle affordance. */
  onEdit: () => void;
  onDiscard: () => void;
  onRefresh: () => void;
  onApplyAnyway: () => void;
  /** Navigate to the applied item; when omitted, the "View item" link is hidden. */
  onViewItem?: (itemId: string) => void;
  /** Applied wording (memory ops override e.g. "Memory logged."). Default "Applied." */
  appliedMessage?: string;
  /** Applied link label. Default "View item →". */
  viewItemLabel?: string;
}

/** Shared banner shell — a status `<output>` (implicit role=status) in one of three tones. */
function Banner({
  tone,
  children,
}: Readonly<{ tone: "primary" | "destructive"; children: ReactNode }>) {
  return (
    <output
      className={cn(
        "block rounded-md border px-3.5 py-3 text-sm",
        tone === "destructive"
          ? "border-destructive/40 bg-destructive/5 text-foreground"
          : "border-primary/40 bg-primary/5 text-foreground",
      )}
    >
      {children}
    </output>
  );
}

/** Optimistic in-flight state — accept feels instant. */
function ApplyingView() {
  return (
    <Banner tone="primary">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
        />
        Applying your change…
      </span>
    </Banner>
  );
}

/** Terminal success — "Applied ✓" with the one optional, after-the-fact navigation. */
function AppliedView({
  itemId,
  message,
  viewItemLabel,
  onViewItem,
}: Readonly<{
  itemId: string;
  message: string;
  viewItemLabel: string;
  onViewItem?: (itemId: string) => void;
}>) {
  return (
    <Banner tone="primary">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{message}</span>
        {onViewItem && itemId ? (
          <Button
            size="xs"
            variant="link"
            className="h-auto p-0 text-primary"
            onClick={() => onViewItem(itemId)}
          >
            {viewItemLabel}
          </Button>
        ) : null}
      </span>
    </Banner>
  );
}

/**
 * "Needs attention" — legible failure for `invalid` or `failed`, rendering the
 * server's plain-language `message` (never a raw 500).
 *
 * The action set is driven by `retryable`, and the copy MUST agree with it:
 *  - `retryable` → the proposal is still live: Retry / Edit / Discard, and we say so.
 *  - NOT `retryable` → TERMINAL: this can't be re-applied, so we offer Discard only
 *    (acknowledge) and never dangle a dead Retry/Edit or imply it's still fixable.
 */
function NeedsAttentionView({
  message,
  retryable,
  busy,
  onRetry,
  onEdit,
  onDiscard,
}: Readonly<{
  message: string;
  retryable: boolean;
  busy: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}>) {
  return (
    <Banner tone="destructive">
      <p className="font-semibold text-foreground">Couldn’t apply this proposal</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      {retryable ? (
        <>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Nothing was applied — the proposal is still here to retry, edit, or discard.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" variant="default" disabled={busy} onClick={onRetry}>
              Retry
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Nothing was applied, and this can’t be retried as-is. You can discard it.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </>
      )}
    </Banner>
  );
}

/**
 * "This item changed" — the reactive graceful-staleness surface (never a silent
 * clobber). Refresh re-bases; Apply-anyway is a best-effort override, NOT a
 * promise: for the memory conflict that fires this today the server can still
 * decline it, so the copy says "try to apply", never "will apply".
 */
function ItemChangedView({
  message,
  busy,
  onRefresh,
  onDiscard,
  onApplyAnyway,
}: Readonly<{
  message: string;
  busy: boolean;
  onRefresh: () => void;
  onDiscard: () => void;
  onApplyAnyway: () => void;
}>) {
  return (
    <Banner tone="primary">
      <p className="font-semibold text-foreground">This item changed</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="default" disabled={busy} onClick={onRefresh}>
          Refresh
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onApplyAnyway}>
          Apply anyway
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Refresh to see the current item first. Apply anyway will try to apply the agent’s
        original — the server may still decline it if the conflict stands.
      </p>
    </Banner>
  );
}

/** A minimal muted acknowledgement — nothing to act on (gone / already handled / discarded). */
function MinimalView({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <output className="block rounded-md border border-border bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
      {children}
    </output>
  );
}

export function AcceptStateView({
  phase,
  result,
  busy,
  onRetry,
  onEdit,
  onDiscard,
  onRefresh,
  onApplyAnyway,
  onViewItem,
  appliedMessage = "Applied.",
  viewItemLabel = "View item →",
}: Readonly<AcceptStateViewProps>) {
  if (phase === "idle") return null;
  if (phase === "applying") return <ApplyingView />;
  if (phase === "rejected") return <MinimalView>Discarded.</MinimalView>;

  // phase === "settled" — branch on the typed envelope.
  if (!result) return null;
  switch (result.status) {
    case "applied":
      return (
        <AppliedView
          itemId={result.item_id}
          message={appliedMessage}
          viewItemLabel={viewItemLabel}
          onViewItem={onViewItem}
        />
      );
    case "invalid":
    case "failed":
      return (
        <NeedsAttentionView
          message={result.message}
          retryable={result.retryable}
          busy={busy}
          onRetry={onRetry}
          onEdit={onEdit}
          onDiscard={onDiscard}
        />
      );
    case "stale":
      return (
        <ItemChangedView
          message={result.message}
          busy={busy}
          onRefresh={onRefresh}
          onDiscard={onDiscard}
          onApplyAnyway={onApplyAnyway}
        />
      );
    case "not_found":
      return <MinimalView>This proposal is no longer available.</MinimalView>;
    case "not_pending":
      return <MinimalView>Already handled.</MinimalView>;
    default:
      return null;
  }
}
