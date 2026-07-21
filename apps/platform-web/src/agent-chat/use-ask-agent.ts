import * as React from "react";

import type { AskAgent } from "./ask-agent";

/**
 * The context carrying the single agent-invocation seam. Lives here (apart from
 * the {@link AskAgentProvider} alias in `ask-agent.tsx`) so this hook module
 * exports no React components — keeping Fast Refresh happy.
 */
export const AskAgentContext = React.createContext<AskAgent | null>(null);

/**
 * Access the single agent-invocation seam. Throws if used outside an
 * `AskAgentProvider` so a miswired call site fails loudly, not silently.
 */
export function useAskAgent(): AskAgent {
  const askAgent = React.useContext(AskAgentContext);
  if (askAgent === null) {
    throw new Error("useAskAgent must be used within an AskAgentProvider");
  }
  return askAgent;
}
