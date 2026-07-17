/**
 * "Rules active when this was drafted: […]" — a provenance badge on a WORK-ITEM proposal
 * whose authoring run had rule attributions (the rules injected into the agent's
 * context when it drafted the proposal). Worded as active-DURING, deliberately not
 * "caused by": an injected rule is context the agent had, not a proven cause.
 *
 * Presentational only. The join it needs — the run's rule attributions →
 * `memories` filtered to `kind='rule'` → their titles — is a SERVER concern: the
 * `Proposal` seam carries no attributions and there is no client endpoint for a
 * run's injected rules today, so the parent passes `[]` and this renders nothing
 * (a graceful no-op). When that data lands (a `rule_attributions` join on the
 * proposal/run payload), pass the resolved titles and the badge lights up with no
 * further change here. See the Task 5 report for the tracked follow-up.
 */
export function RuleAttributionBadge({
  ruleTitles,
}: Readonly<{ ruleTitles: readonly string[] }>) {
  if (ruleTitles.length === 0) return null;
  return (
    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Rules active when this was drafted: </span>
      {ruleTitles.join(", ")}
    </p>
  );
}
