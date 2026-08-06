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
 *  - EITHER COHORT EMPTY — there is no comparison at all yet, so the card says
 *    measurement hasn't started and reports the raw arm counts. This branch is
 *    checked BEFORE `verdict`: a comparison needs two arms, so an empty arm can
 *    only ever mean not-started, whatever the server called it (UX audit F3).
 *  - `insufficient` — both arms have runs but not enough for a confident call:
 *    muted "measuring" copy + the small cohort counts, and NO headline number.
 *  - `helps` — memory measurably lowered the edit burden: the saved-edits
 *    headline (the `~` stays — it is an estimate) + a comparison line carrying
 *    BOTH cohorts' edit rates and counts, plus a one-line holdout disclosure.
 *  - `hurts` — the treated cohort is edited MORE: an amber caution (mirroring
 *    the P2a `RuleProposalSurface` "applies everywhere" treatment) that names
 *    both rates and points to the rule list below (this same board), plus the
 *    holdout disclosure. Uses `role="status"` (not `alert`) — a persistent stat
 *    should not interrupt screen readers on every mount.
 *
 * The saved-edits number renders ONLY on `helps`. On error the card renders
 * nothing (honest silence); while loading it reserves its space with a skeleton
 * so the board below does not shift when the measurement resolves.
 */
export function MemoryImpactCard() {
  const { impact, loading, error } = useMemoryImpact();

  if (loading) {
    return (
      <output
        aria-label="Measuring memory impact"
        className="block h-20 w-full animate-pulse rounded-lg bg-muted"
      />
    );
  }
  if (error !== null || impact === null) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5">
      {renderImpact(impact)}
    </div>
  );
}

/**
 * True when either arm has no runs. A holdout comparison needs BOTH a treated and
 * a control arm; with one of them empty nothing has been compared, so no verdict —
 * `insufficient` included — describes the state honestly.
 */
function hasEmptyArm(impact: MemoryImpact): boolean {
  return impact.holdout.applied === 0 || impact.treated.applied === 0;
}

function renderImpact(impact: MemoryImpact) {
  if (hasEmptyArm(impact)) return renderNotStarted(impact);
  if (impact.verdict === "helps") return renderHelps(impact);
  if (impact.verdict === "hurts") return renderHurts(impact);
  return renderInsufficient(impact);
}

/**
 * EITHER ARM EMPTY — no comparison exists. States that plainly and reports the
 * real counts, so the reader can see which arm is missing rather than being told
 * a measurement is under way.
 */
function renderNotStarted(impact: MemoryImpact) {
  const { holdout, treated } = impact;
  const proposalWord = treated.applied === 1 ? "proposal" : "proposals";
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Memory&apos;s impact measurement hasn&apos;t started — it needs runs both
        with and without memory.
      </p>
      <p className="text-xs text-muted-foreground">
        {`So far: ${treated.applied} ${proposalWord} with memory, ${holdout.applied} without.`}
      </p>
    </>
  );
}

/** The one-line holdout disclosure shown under the `helps`/`hurts` states. */
function renderHoldoutDisclosure() {
  return (
    <p className="text-xs text-muted-foreground">
      To keep this measurement honest, a small share of runs skip memory.
    </p>
  );
}

/** `insufficient` — muted measuring copy + the raw cohort counts, NO headline. */
function renderInsufficient(impact: MemoryImpact) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Measuring how much memory helps — the number appears once there's enough
        evidence to be sure.
      </p>
      <p className="text-xs text-muted-foreground">
        {`Comparing ${impact.treated.applied} proposals with memory and ${impact.holdout.applied} without, so far.`}
      </p>
    </>
  );
}

/** `helps` — the saved-edits headline (the `~` stays) + the both-cohort comparison. */
function renderHelps(impact: MemoryImpact) {
  const { holdout, treated, savedEdits, window_days } = impact;
  const editWord = savedEdits === 1 ? "edit" : "edits";
  return (
    <>
      <p className="text-sm font-semibold text-foreground">
        {`Memory saved you ~${savedEdits} ${editWord} in the last ${window_days} days`}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {`Without memory you edited ${pct(holdout.editRate)} of proposals (${holdout.edited} of ${holdout.applied}); with it, ${pct(treated.editRate)} (${treated.edited} of ${treated.applied}).`}
      </p>
      {renderHoldoutDisclosure()}
    </>
  );
}

/** `hurts` — amber caution (mirrors P2a) naming both rates + the holdout disclosure. */
function renderHurts(impact: MemoryImpact) {
  const { holdout, treated } = impact;
  return (
    <>
      <div
        role="status"
        className="flex flex-col gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400"
      >
        <p className="leading-relaxed">
          {`You're editing more of the agent's proposals with memory on (${pct(treated.editRate)} vs ${pct(holdout.editRate)} without it). Your rules are listed below — retract any that look too broad.`}
        </p>
      </div>
      {renderHoldoutDisclosure()}
    </>
  );
}
