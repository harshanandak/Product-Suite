import { AskAgentContext } from "./use-ask-agent";

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

/**
 * Provides the agent-invocation seam to the subtree (the shell wires it). The
 * matching `useAskAgent` hook and its context live in `./use-ask-agent`.
 */
export const AskAgentProvider = AskAgentContext.Provider;
