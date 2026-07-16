import { useState } from "react";

import { Badge, Button, cn } from "@product-suite/ui";

import type { Proposal } from "@/data/proposals";

import { formatConfidence } from "./field-diff";

/** The strength a reviewer settles on for a rule — how firmly it will be applied. */
export interface RuleStrength {
  /** `advisory` (a hint the agent may weigh) or `hard` (an invariant to enforce). */
  readonly enforcement: "advisory" | "hard";
  /** Pinned rules are surfaced first (a budget-priority, not enforcement). */
  readonly pinned: boolean;
}

/** Read a string attr off the payload's `attrs` bag (else `null`). */
function attrString(attrs: unknown, key: string): string | null {
  if (attrs && typeof attrs === "object") {
    const value = (attrs as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return null;
}

/** Count the evidence proposal ids that clustered into this rule (else 0). */
function evidenceCount(attrs: unknown): number {
  if (attrs && typeof attrs === "object") {
    const ids = (attrs as Record<string, unknown>).evidence_proposal_ids;
    if (Array.isArray(ids)) return ids.length;
  }
  return 0;
}

/**
 * The RULE decision surface (Memory Brain P2a) — a reflection-authored `kind='rule'`
 * proposal made reviewable. Unlike a decision/fact memory, a rule carries an
 * APPLICABILITY (`attrs.applies_when` — when it fires) and EVIDENCE (`attrs.
 * evidence_proposal_ids` — the recurring corrections it was distilled from, shown as
 * "changed N×"), and the reviewer sets its STRENGTH before accepting: advisory (a hint)
 * vs hard (an invariant), plus whether to pin it (surface first under the injection
 * budget). It is purely presentational — it owns only the transient control state and
 * reports every change up via {@link onStrengthChange}; the PARENT owns Accept and folds
 * the chosen strength into the full merged `edited_payload`.
 */
export function RuleProposalSurface({
  proposal,
  onStrengthChange,
}: Readonly<{
  proposal: Proposal;
  onStrengthChange: (strength: RuleStrength) => void;
}>) {
  const payload = proposal.payload as Record<string, unknown>;
  const directive = typeof payload.title === "string" ? payload.title : "Untitled rule";
  const appliesWhen = attrString(payload.attrs, "applies_when");
  const changes = evidenceCount(payload.attrs);
  const confidence = formatConfidence(proposal.confidence);

  const [enforcement, setEnforcement] = useState<"advisory" | "hard">(
    payload.enforcement === "hard" ? "hard" : "advisory",
  );
  const [pinned, setPinned] = useState<boolean>(payload.pinned === true);

  const emit = (next: RuleStrength): void => {
    setEnforcement(next.enforcement);
    setPinned(next.pinned);
    onStrengthChange(next);
  };

  const isHard = enforcement === "hard";

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          Log a rule: “{directive}”
        </h2>
        {confidence ? (
          <Badge
            variant="outline"
            className="flex-none font-mono text-[11px] text-muted-foreground"
            title="Model confidence"
          >
            {confidence}
          </Badge>
        ) : null}
      </header>

      {/* the agent's rationale for proposing this rule — secondary */}
      {proposal.rationale ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium">Why proposed: </span>
          {proposal.rationale}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Rule
        </div>
        <dl className="divide-y divide-border">
          <div className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-3 px-3 py-2 text-sm">
            <dt className="truncate font-mono text-xs text-muted-foreground">applies when</dt>
            <dd className="min-w-0 break-words text-foreground">
              {appliesWhen ?? (
                <span className="italic text-muted-foreground">any context</span>
              )}
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-3 px-3 py-2 text-sm">
            <dt className="truncate font-mono text-xs text-muted-foreground">evidence</dt>
            <dd className="min-w-0 break-words text-foreground">
              changed {changes}× before this rule was proposed
            </dd>
          </div>
        </dl>
      </div>

      {/* strength controls — the reviewer decides how firmly the rule applies */}
      <fieldset className="flex flex-col gap-2.5 rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">Strength</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={isHard ? "default" : "outline"}
            className="text-[11px] uppercase tracking-wide"
          >
            {isHard ? "hard" : "advisory"}
          </Badge>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              emit({ enforcement: isHard ? "advisory" : "hard", pinned })
            }
          >
            {isHard ? "Mark as advisory" : "Mark as hard"}
          </Button>
          <label className="ml-1 flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              className={cn(
                "size-3.5 rounded border-border accent-primary",
                "focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
              checked={pinned}
              onChange={(event) =>
                emit({ enforcement, pinned: event.target.checked })
              }
            />
            Pin (surface first)
          </label>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {isHard
            ? "Hard rules are enforced as invariants."
            : "Advisory rules are hints the agent weighs, not invariants."}
        </p>
      </fieldset>
    </>
  );
}
