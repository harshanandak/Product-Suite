import { Link } from "@tanstack/react-router";
import { getToolName, isToolUIPart, type ToolUIPart } from "ai";
import { ArrowRight } from "lucide-react";

import { cn } from "@product-suite/ui";

/**
 * The data a {@link ProposalCard} renders, extracted from a `propose_*` tool
 * part. Per the grounding decision this comes from the tool-call INPUT args
 * (title / patch / rationale) plus the `proposal_id` from the bare tool OUTPUT —
 * there is NO backend enrichment, and confidence is not in the input, so it is
 * intentionally absent here.
 */
export interface ProposalCardData {
  operation: "create" | "update";
  proposalId: string;
  title: string;
  summary?: string;
}

/** The shape of a `propose_*` tool result (`agent/tools.ts`). */
interface ProposeOutput {
  proposed?: boolean;
  proposal_id?: string;
  error?: string;
}

/** First defined string among the candidates, else undefined. */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

/**
 * Build the card data from a settled `propose_*` tool part, or `null` when the
 * part is not a completed, successful proposal (wrong tool, still running, or a
 * refusal). Reads ONLY the tool INPUT + the `proposal_id` from the OUTPUT.
 */
export function proposalCardFromToolPart(
  part: ToolUIPart,
): ProposalCardData | null {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  if (name !== "propose_create" && name !== "propose_update") return null;
  if (part.state !== "output-available") return null;

  const output = part.output as ProposeOutput | undefined;
  if (!output?.proposed || typeof output.proposal_id !== "string") return null;
  const proposalId = output.proposal_id;

  const input = (part.input ?? {}) as Record<string, unknown>;

  if (name === "propose_create") {
    return {
      operation: "create",
      proposalId,
      title: firstString(input.title) ?? "Untitled proposal",
      summary: firstString(input.rationale, input.description),
    };
  }

  // propose_update: title from the patch when present, else name the target id.
  const patch = (input.patch ?? {}) as Record<string, unknown>;
  const targetId = firstString(input.id);
  return {
    operation: "update",
    proposalId,
    title:
      firstString(patch.title) ??
      (targetId ? `Update to ${targetId}` : "Proposed update"),
    summary: firstString(input.rationale),
  };
}

/**
 * The proposal moment (DESIGN §3): a distinct card in the message stream when a
 * `propose_*` tool completes — operation badge, proposed title, a short summary,
 * a "Pending review" pill, and the ONE primary action, "Review in Inbox →",
 * deep-linking to that proposal's detail. There is NO inline accept, ever:
 * disposition happens only in the Inbox (agent proposes, human disposes).
 */
export function ProposalCard({
  data,
  workspace,
}: Readonly<{ data: ProposalCardData; workspace: string }>) {
  const isCreate = data.operation === "create";
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-xs font-medium",
            isCreate
              ? "bg-primary/10 text-primary"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {isCreate ? "Create" : "Update"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Pending review
        </span>
      </div>

      <p className="mt-2 font-medium text-foreground">{data.title}</p>
      {data.summary ? (
        <p className="mt-1 line-clamp-3 text-muted-foreground">{data.summary}</p>
      ) : null}

      <Link
        to="/w/$workspace/inbox"
        params={{ workspace }}
        search={{ proposal: data.proposalId }}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        Review in Inbox
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
