/**
 * Human, present-tense verbs for the agent's tool calls — the #1 trust feature
 * (DESIGN §5a). While a tool runs we show "Reading the board…" rather than a raw
 * `list_work_items`, so the user always sees what the agent is doing.
 */
const TOOL_LABELS: Record<string, string> = {
  list_work_items: "Reading the board…",
  get_work_item: "Reading an item…",
  search_items: "Searching…",
  propose_create: "Drafting a proposal…",
  propose_update: "Drafting a proposal…",
};

/** The two tools that queue a proposal (rendered as a ProposalCard, not a status line). */
export const PROPOSE_TOOLS = new Set(["propose_create", "propose_update"]);

/** A friendly status verb for a tool call; falls back to a generic label. */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "Working…";
}

/** Whether a tool name is one of the propose_* proposal-queuing tools. */
export function isProposeTool(name: string): boolean {
  return PROPOSE_TOOLS.has(name);
}
