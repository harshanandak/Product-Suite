/**
 * Memory-impact data-seam vocabulary (Memory Brain P2b).
 *
 * A {@link MemoryImpact} is the honest, CI-gated measurement of whether memory
 * reduced the human's editing burden: a holdout cohort (agent ran WITHOUT the
 * org's memory) vs a treated cohort (WITH it), plus the delta, a confidence
 * interval, and a `verdict` the UI branches on. It mirrors the real backend
 * shape exactly (`GET /api/agent/memory-impact`): the adapter never reshapes it,
 * so the card reasons about precisely what the server measured.
 */

/**
 * One cohort's proposal-review outcomes over the window. `applied` is how many
 * of the agent's proposals were applied; `edited`/`rejected` are how many of
 * those the human then edited / rejected. `editRate`/`rejectRate` are FRACTIONS
 * in `[0, 1]` (e.g. `0.167` ⇒ "17%") — the card formats them as whole percents.
 */
export interface Cohort {
  /** Proposals applied in this cohort (the denominator for the rates). */
  readonly applied: number;
  /** Of the applied proposals, how many the human then edited. */
  readonly edited: number;
  /** `edited / applied` as a fraction in [0, 1]. */
  readonly editRate: number;
  /** Of the applied proposals, how many the human rejected. */
  readonly rejected: number;
  /** `rejected / applied` as a fraction in [0, 1]. */
  readonly rejectRate: number;
  /**
   * Distinct threads that contributed an applied proposal in this cohort. The
   * server's clustering guard declines a help/hurt verdict when either cohort has
   * too few (holdout assignment is per-thread, so a handful of chatty threads is
   * weak independent evidence). The card mirrors the shape but does NOT display it.
   */
  readonly threads: number;
}

/**
 * The verdict the card branches on — honest by construction:
 * - `helps` — memory measurably lowered the edit rate; show the saved-edits headline.
 * - `hurts` — the treated cohort is edited MORE; show the amber caution + review link.
 * - `insufficient` — not enough data for a confident call; show NO headline number.
 */
export type MemoryImpactVerdict = "helps" | "hurts" | "insufficient";

/**
 * The measured impact of memory over a rolling window (`GET
 * /api/agent/memory-impact?window=N`). The `savedEdits` headline is only
 * meaningful — and only rendered — when `verdict === 'helps'`.
 */
export interface MemoryImpact {
  /** The rolling window measured, in days (echoes the `?window` request). */
  readonly window_days: number;
  /** The control cohort: the agent ran WITHOUT the org's memory. */
  readonly holdout: Cohort;
  /** The treated cohort: the agent ran WITH the org's memory. */
  readonly treated: Cohort;
  /** `holdout.editRate - treated.editRate` (positive ⇒ memory helped). */
  readonly delta: number;
  /** Estimated human edits avoided over the window (headline when `helps`). */
  readonly savedEdits: number;
  /** Low bound of the 95% CI on the edit-rate delta (holdout − treated), not on `savedEdits`. */
  readonly ciLow: number;
  /** High bound of the 95% CI on the edit-rate delta (holdout − treated), not on `savedEdits`. */
  readonly ciHigh: number;
  /** The honest call the card branches on. */
  readonly verdict: MemoryImpactVerdict;
}
