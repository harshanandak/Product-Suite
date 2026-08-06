import { Badge } from "@product-suite/ui";

import type { CuratorCollision, CuratorVerdict } from "@/data/proposals";

/**
 * The curator's verdict on a memory proposal, shown INLINE before the reviewer decides
 * (research rec #3; SAP's Global Memory Curator). It answers two questions at a glance:
 * is this candidate well-formed on its own, and does it duplicate / overlap with /
 * contradict a memory already stored — naming the specific colliding memory.
 *
 * ADVISORY, and it looks it. The panel renders no control of its own and cannot disable
 * one: the moment a heuristic can block a human, it stops being a hint and the review
 * gate stops being human. It exists to keep volume from turning that gate into a rubber
 * stamp, which is the opposite failure.
 *
 * No new visual vocabulary — the same bordered muted block as {@link RuleAttributionBadge},
 * which is the Inbox's settled treatment for "context about this proposal".
 */

/** The headline label + tone per outcome. `not_applicable` renders nothing at all. */
const OUTCOME: Record<
  Exclude<CuratorVerdict["outcome"], "not_applicable">,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  conflict: { label: "Contradicts existing memory", variant: "destructive" },
  duplicate: { label: "Duplicate", variant: "secondary" },
  overlap: { label: "Overlaps existing memory", variant: "secondary" },
  quality_only: { label: "Needs tightening", variant: "outline" },
  clean: { label: "Novel", variant: "outline" },
};

/** How each relation reads in a sentence — a conflict must not read like a duplicate. */
const RELATION_VERB: Record<CuratorCollision["relation"], string> = {
  conflict: "Contradicts",
  duplicate: "Duplicates",
  overlap: "Overlaps",
};

function CollisionRow({ collision }: Readonly<{ collision: CuratorCollision }>) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-foreground">
        <span className="font-medium">{RELATION_VERB[collision.relation]}</span>{" "}
        {/* A private collider is the reviewer's OWN note. Saying so is load-bearing:
            a personal memory must never be read as the organization's position. */}
        {collision.visibility === "private" ? "your private note " : ""}
        <span className="font-medium">“{collision.title}”</span>{" "}
        <span className="text-muted-foreground">({collision.memory_id})</span>
      </span>
      <span className="text-muted-foreground">{collision.reason}</span>
    </li>
  );
}

export function CuratorVerdictPanel({
  verdict,
}: Readonly<{ verdict: CuratorVerdict | null }>) {
  // No verdict (fixture mode, or a read that failed) and nothing to curate both render
  // nothing. A missing hint must never look like a clean bill of health, and it must
  // never stand between a human and a decision.
  if (verdict === null || verdict.outcome === "not_applicable") return null;

  const outcome = OUTCOME[verdict.outcome];

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <header className="flex items-center gap-2">
        <span className="font-medium text-foreground">Curator check</span>
        <Badge variant={outcome.variant}>{outcome.label}</Badge>
        <span className="ml-auto text-muted-foreground">advisory</span>
      </header>

      <p className="text-muted-foreground">{verdict.summary}</p>

      {verdict.collisions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {verdict.collisions.map((collision) => (
            <CollisionRow key={collision.memory_id} collision={collision} />
          ))}
        </ul>
      ) : null}

      {verdict.quality.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
          {verdict.quality.map((finding) => (
            // The reason, never the code — a reviewer acts on the sentence.
            <li key={finding.code}>{finding.reason}</li>
          ))}
        </ul>
      ) : null}

      {verdict.private_lane_skipped ? (
        <p className="text-muted-foreground">
          Checked against org memory only — your personal memories were not included.
        </p>
      ) : null}
    </section>
  );
}
