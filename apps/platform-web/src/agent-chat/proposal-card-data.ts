import { getToolName, isToolUIPart, type ToolUIPart } from "ai";

/**
 * The data a {@link ProposalCard} renders, extracted from a `propose_*` tool
 * part. Per the grounding decision this comes from the tool-call INPUT args
 * (title / patch / rationale) plus the `proposal_id` from the bare tool OUTPUT —
 * there is NO backend enrichment, and confidence is not in the input, so it is
 * intentionally absent here.
 *
 * Lives in its own module (not beside the component) so `ProposalCard.tsx` only
 * exports a component — keeping React Fast Refresh's single-export boundary
 * clean (`react-refresh/only-export-components`).
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

  // propose_update: title from the patch when present, else a generic label —
  // never a raw uuid (noise in the transcript; the Inbox shows the real target).
  const patch = (input.patch ?? {}) as Record<string, unknown>;
  return {
    operation: "update",
    proposalId,
    title: firstString(patch.title) ?? "Proposed update",
    summary: firstString(input.rationale),
  };
}
