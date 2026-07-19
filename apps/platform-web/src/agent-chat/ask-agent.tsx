import * as React from "react";

/**
 * Optional context handed to the agent when it's invoked. Kept intentionally
 * minimal — only what today's call sites need. Grow it when a real call site
 * needs more (e.g. a linked object), not speculatively.
 */
export interface AskAgentOptions {
  /** Seed text for the chat input (selected text, a row's title, …). */
  prompt?: string;
}

/**
 * The single seam for opening the agent chat programmatically. The ⌘K palette's
 * "Ask agent" is the first caller; upcoming invocation points — a row
 * context-menu "Ask agent", a selection popover — will call this SAME function
 * so that open / focus / already-open semantics live in exactly one place
 * instead of each call site poking at the shell's panel state.
 */
export type AskAgent = (options?: AskAgentOptions) => void;

/**
 * A focus request the shell hands to the (always-mounted) panel. `nonce` changes
 * on every invocation so the panel re-focuses its input even when it is already
 * open; `prompt` optionally seeds the input.
 */
export interface AgentFocusRequest {
  nonce: number;
  prompt?: string;
}

const AskAgentContext = React.createContext<AskAgent | null>(null);

/** Provides the {@link useAskAgent} seam to the subtree (the shell wires it). */
export const AskAgentProvider = AskAgentContext.Provider;

/**
 * Access the single agent-invocation seam. Throws if used outside an
 * {@link AskAgentProvider} so a miswired call site fails loudly, not silently.
 */
export function useAskAgent(): AskAgent {
  const askAgent = React.useContext(AskAgentContext);
  if (askAgent === null) {
    throw new Error("useAskAgent must be used within an AskAgentProvider");
  }
  return askAgent;
}
