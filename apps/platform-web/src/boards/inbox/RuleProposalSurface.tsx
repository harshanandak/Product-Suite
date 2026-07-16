import { useState } from "react";

import { Badge, Checkbox, cn } from "@product-suite/ui";

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

/** The evidence proposal ids that clustered into this rule (else `[]`). */
function evidenceIds(attrs: unknown): readonly string[] {
  if (attrs && typeof attrs === "object") {
    const ids = (attrs as Record<string, unknown>).evidence_proposal_ids;
    if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === "string");
  }
  return [];
}

/** "1 time" / "N times" — active-voice count for the evidence line. */
function timesLabel(count: number): string {
  return count === 1 ? "1 time" : `${count} times`;
}

/**
 * The RULE decision surface (Memory Brain P2a) — a reflection-authored `kind='rule'`
 * proposal made reviewable, presented as a *visible, controllable conversation*: the
 * reviewer sees WHAT the agent wants to learn, the recurring edits it was distilled from
 * (inspectable, not just a count), WHEN it fires (with a loud warning when it has no
 * conditions and would apply everywhere), and decides HOW firmly it applies before
 * accepting — a plain "Suggestion" vs "Always follow" choice plus an optional
 * "Prioritize". It is purely presentational — it owns only the transient control state
 * and reports every change up via {@link onStrengthChange}; the PARENT owns Accept and
 * folds the chosen strength into the full merged `edited_payload`.
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
  const evidence = evidenceIds(payload.attrs);
  const confidence = formatConfidence(proposal.confidence);

  const [enforcement, setEnforcement] = useState<"advisory" | "hard">(
    payload.enforcement === "hard" ? "hard" : "advisory",
  );
  const [pinned, setPinned] = useState<boolean>(payload.pinned === true);
  const [showEvidence, setShowEvidence] = useState(false);

  const emit = (next: RuleStrength): void => {
    setEnforcement(next.enforcement);
    setPinned(next.pinned);
    onStrengthChange(next);
  };

  const isHard = enforcement === "hard";

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">
            The agent wants to learn a rule
          </h2>
          <p className="min-w-0 break-words text-sm font-medium text-foreground">
            “{directive}”
          </p>
        </div>
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

      {/* WHEN the rule fires — a loud warning when it has no conditions. */}
      {appliesWhen ? (
        <div className="overflow-hidden rounded-md border border-border">
          <dl className="divide-y divide-border">
            <div className="grid grid-cols-[minmax(6rem,8rem)_1fr] gap-3 px-3 py-2 text-sm">
              <dt className="truncate font-mono text-xs text-muted-foreground">applies when</dt>
              <dd className="min-w-0 break-words text-foreground">{appliesWhen}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          <span className="font-semibold">Applies everywhere</span> — this rule has no
          conditions.
        </p>
      )}

      {/* EVIDENCE — inspectable, not just a number. The recurring corrections the
          rule was distilled from, so the reviewer can catch an over-generalization. */}
      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <p className="text-sm text-foreground">
          You made this same edit {timesLabel(evidence.length)}.
        </p>
        {evidence.length > 0 ? (
          <div>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              aria-expanded={showEvidence}
              onClick={() => setShowEvidence((open) => !open)}
            >
              {showEvidence ? "Hide" : "Show"} the {timesLabel(evidence.length)}
            </button>
            {showEvidence ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <ul className="flex flex-col gap-1">
                  {evidence.map((id) => (
                    <li
                      key={id}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {id}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  These are the source corrections this rule was learned from. Richer
                  previews of each edit are coming soon.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* STRENGTH — plain-language, mutually-exclusive selectable cards (the design
          system has no radio primitive; this mirrors the LogDecisionForm toggle-card
          pattern with aria-pressed for accessible single-select). */}
      <fieldset className="flex flex-col gap-2.5 rounded-md border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          How firmly should the agent follow this?
        </legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          <StrengthCard
            label="Suggestion"
            helper="The agent weighs this and may override it when context says otherwise."
            selected={!isHard}
            onSelect={() => emit({ enforcement: "advisory", pinned })}
          />
          <StrengthCard
            label="Always follow"
            helper="The agent never violates this."
            selected={isHard}
            onSelect={() => emit({ enforcement: "hard", pinned })}
          />
        </div>
        <label className="mt-1 flex items-start gap-2 text-sm text-foreground">
          <Checkbox
            className="mt-0.5"
            checked={pinned}
            onCheckedChange={(checked) =>
              emit({ enforcement, pinned: checked === true })
            }
            aria-label="Prioritize"
          />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">Prioritize</span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Always keep this rule in front of the agent, even when space is tight.
            </span>
          </span>
        </label>
      </fieldset>

      {/* Plain-language statement of what Accept will do, reflecting the selection. */}
      <p className="text-sm leading-relaxed text-muted-foreground">
        From now on, when {appliesWhen ?? "any work item"}, the agent will{" "}
        <span className="font-medium text-foreground">{directive}</span>{" "}
        {isHard ? "(as a rule it always follows)." : "(as a suggestion it weighs)."}
      </p>
    </>
  );
}

/** One selectable strength option — a card that behaves as a single-select radio. */
function StrengthCard({
  label,
  helper,
  selected,
  onSelect,
}: Readonly<{
  label: string;
  helper: string;
  selected: boolean;
  onSelect: () => void;
}>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-1 flex-col gap-0.5 rounded-md border p-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/50",
      )}
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{helper}</span>
    </button>
  );
}
