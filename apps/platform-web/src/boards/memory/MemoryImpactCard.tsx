import { Link, useParams } from "@tanstack/react-router";

import { useMemoryImpact } from "@/data/memory-impact";
import type { MemoryImpact } from "@/data/memory-impact";

/** Format a fraction rate in [0, 1] as a whole percent (e.g. `0.167` → "17%"). */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * The "Saved N edits" card (Memory Brain P2b) — the honest, CI-gated surface of
 * memory's measured value. It compares a HOLDOUT cohort (the agent ran WITHOUT
 * the org's memory) against a TREATED cohort (WITH it) and branches on the
 * server's `verdict`, honest by construction:
 *
 *  - `insufficient` — not enough data for a confident call: muted "measuring"
 *    copy + the small cohort counts, and NO headline number.
 *  - `helps` — memory measurably lowered the edit burden: the saved-edits
 *    headline (the `~` stays — it is an estimate) + a comparison line carrying
 *    BOTH cohorts' edit rates and applied counts.
 *  - `hurts` — the treated cohort is edited MORE: an amber caution (mirroring
 *    the P2a `RuleProposalSurface` "applies everywhere" treatment) that names
 *    both rates and links to the rule list to review.
 *
 * The saved-edits number renders ONLY on `helps`. While loading or on error the
 * card renders nothing — honest silence, no flash of a half-measured claim.
 */
export function MemoryImpactCard() {
  const { impact, loading, error } = useMemoryImpact();
  // Called unconditionally (rules of hooks); only the `hurts` branch uses it. The
  // card mounts on the Memory board (Decision Log = the rule list) — link there.
  const params = useParams({ strict: false }) as { workspace?: string };
  const rulesHref = `/w/${params.workspace ?? ""}/memory`;

  if (loading || error !== null || impact === null) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5">
      {impact.verdict === "helps"
        ? renderHelps(impact)
        : impact.verdict === "hurts"
          ? renderHurts(impact, rulesHref)
          : renderInsufficient(impact)}
    </div>
  );
}

/** `insufficient` — muted measuring copy + the raw cohort counts, NO headline. */
function renderInsufficient(impact: MemoryImpact) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Measuring how much memory helps — not enough data yet.
      </p>
      <p className="text-xs text-muted-foreground">
        {`Based on ${impact.holdout.applied} / ${impact.treated.applied} proposals so far.`}
      </p>
    </>
  );
}

/** `helps` — the saved-edits headline (the `~` stays) + the both-cohort comparison. */
function renderHelps(impact: MemoryImpact) {
  const { holdout, treated, savedEdits, window_days } = impact;
  return (
    <>
      <p className="text-sm font-semibold text-foreground">
        {`Memory saved you ~${savedEdits} edits in the last ${window_days} days`}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {`You edited ${pct(holdout.editRate)} of the agent's proposals without memory (from ${holdout.applied}), vs ${pct(treated.editRate)} with it (from ${treated.applied}).`}
      </p>
    </>
  );
}

/** `hurts` — amber caution (mirrors P2a) naming both rates + a link to the rules. */
function renderHurts(impact: MemoryImpact, rulesHref: string) {
  const { holdout, treated } = impact;
  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400"
    >
      <p className="leading-relaxed">
        {`You're editing more of the agent's proposals with memory on (${pct(treated.editRate)} vs ${pct(holdout.editRate)} without it). Your rules may be too broad — review them.`}
      </p>
      <Link
        to={rulesHref}
        className="w-fit text-xs font-medium underline underline-offset-2 hover:no-underline"
      >
        Review your rules
      </Link>
    </div>
  );
}
