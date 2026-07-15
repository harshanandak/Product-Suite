import { useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart, type ToolUIPart, type UIMessage } from "ai";
import { Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@product-suite/ui-chat/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@product-suite/ui-chat/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@product-suite/ui-chat/components/ai-elements/prompt-input";

import {
  createAgentChatTransport,
  type AgentLinkedObject,
} from "@/data/agent/transport";

import { ProposalCard, proposalCardFromToolPart } from "./ProposalCard";
import { isProposeTool, toolLabel } from "./tool-labels";

/** Props for {@link AgentChatPanel}. The shell owns open/close + Clerk. */
export interface AgentChatPanelProps {
  /** Whether the panel is visible. Kept MOUNTED when closed so chat state survives. */
  open: boolean;
  onClose: () => void;
  workspace: string;
  /**
   * The object for the CURRENT screen (updates on navigation). Captured as the
   * thread's linked object the first time the panel opens; drives the
   * "start a new thread here?" affordance when the user navigates elsewhere.
   */
  currentObject: AgentLinkedObject;
  /**
   * Resolve the Clerk session token per request. The shell wires Clerk (or a
   * null resolver in fixtures) so this component never imports `useAuth` — safe
   * to render in preview mode with no ClerkProvider.
   */
  getToken: () => Promise<string | null>;
  /**
   * Resolve the caller's active org id (Clerk `useAuth().orgId`), or `null`.
   * Sent as `org_id` so a user in more than one org anchors the run — without it
   * the API 400s as ambiguous. The shell wires it (null under fixtures).
   */
  getOrgId?: () => string | null;
  /** Optional API origin override (defaults to `API_BASE_URL`). */
  apiBase?: string;
}

/**
 * Whether a chat error is the backend's 403 "no active organization" — the AI
 * SDK surfaces the response body as the error message. Distinguished so we can
 * show a friendly org-required panel instead of a scary chat error bubble.
 */
export function isOrgRequiredError(error: Error | undefined): boolean {
  return !!error && /no active organization/i.test(error.message);
}

/** Object-aware seed prompts for the empty state (DESIGN §5f). */
function suggestionsFor(object: AgentLinkedObject | null): string[] {
  if (object?.type === "work_item") {
    return [
      `Summarize "${object.title}" and suggest next steps`,
      "Propose an update to sharpen this item",
      "What's blocking this item?",
    ];
  }
  return [
    "What's on the board right now?",
    "Find stale work items to clean up",
    "Draft a proposal from our last discussion",
  ];
}

/** A subtle in-progress tool status line — the trust feature (DESIGN §5a). */
function ToolStatus({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

/** Render one message part: markdown text, a proposal card, or a tool status. */
function renderPart(
  part: UIMessage["parts"][number],
  key: string,
  workspace: string,
) {
  if (part.type === "text") {
    return part.text ? <MessageResponse key={key}>{part.text}</MessageResponse> : null;
  }
  if (isToolUIPart(part)) {
    const name = getToolName(part);
    if (isProposeTool(name)) {
      // Our tools are static (never dynamic-tool), so this narrowing is safe.
      const card = proposalCardFromToolPart(part as ToolUIPart);
      if (card) return <ProposalCard key={key} data={card} workspace={workspace} />;
      // A settled propose call with no card is a failure: a refusal
      // (`proposed:false`, output-available) OR a tool error (output-error, e.g.
      // the model's args failed validation). Both surface the SAME quiet line —
      // never leave a "Drafting a proposal…" spinner running forever.
      if (part.state === "output-available" || part.state === "output-error") {
        return (
          <div key={key} className="text-xs text-muted-foreground">
            I couldn&apos;t queue that proposal.
          </div>
        );
      }
      return <ToolStatus key={key} label={toolLabel(name)} />;
    }
    // Read tools: show the verb only while the call is in flight.
    if (part.state !== "output-available" && part.state !== "output-error") {
      return <ToolStatus key={key} label={toolLabel(name)} />;
    }
    return null;
  }
  return null;
}

/**
 * The in-app agent chat panel (DESIGN §2): a right-side, non-modal, shell-level
 * panel. A chat turn runs the agent, which reads the workboard and PROPOSES
 * work-item changes — those surface inline as {@link ProposalCard}s that
 * deep-link to the Review Inbox. The panel NEVER accepts/writes: agent proposes,
 * human disposes. Kept mounted when closed so the ephemeral thread survives
 * close/reopen within the session.
 */
export function AgentChatPanel({
  open,
  onClose,
  workspace,
  currentObject,
  getToken,
  getOrgId,
  apiBase,
}: Readonly<AgentChatPanelProps>) {
  // The thread's linked object: `undefined` = not yet captured; `null` =
  // explicitly unlinked. Captured from the current screen the first time the
  // panel opens, then NEVER rewritten by navigation.
  const [threadObject, setThreadObject] = useState<
    AgentLinkedObject | null | undefined
  >(undefined);
  const threadObjectRef = useRef(threadObject);
  threadObjectRef.current = threadObject;

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const getOrgIdRef = useRef(getOrgId);
  getOrgIdRef.current = getOrgId;

  const [draft, setDraft] = useState("");

  const transport = useMemo(
    () =>
      createAgentChatTransport({
        apiBase,
        getToken: () => getTokenRef.current(),
        getOrgId: () => getOrgIdRef.current?.() ?? null,
        getContext: () => ({
          workspace,
          object: threadObjectRef.current ?? undefined,
        }),
      }),
    [apiBase, workspace],
  );

  const { messages, sendMessage, status, stop, error, regenerate, setMessages } =
    useChat({ transport });

  // Capture the current screen's object as the thread's link on first open.
  useEffect(() => {
    if (open && threadObject === undefined) setThreadObject(currentObject);
  }, [open, threadObject, currentObject]);

  // Escape closes the panel (non-modal: the board stays interactive otherwise).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const linked = threadObject ?? null;
  const navChanged = linked !== null && linked.id !== currentObject.id;
  const orgRequired = isOrgRequiredError(error);
  const isStreaming = status === "submitted" || status === "streaming";

  const submit = (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (text.length === 0) return;
    // Return the send promise so PromptInput can await it; the draft clears
    // immediately. Failures surface through useChat's `error` state (the banner).
    const sent = sendMessage({ text });
    setDraft("");
    return sent;
  };

  const startNewThreadHere = () => {
    setMessages([]);
    setThreadObject(currentObject);
  };

  return (
    <aside
      aria-label="Agent chat"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-border bg-background shadow-xl"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Ask agent</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close agent chat"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      {linked ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
          <span className="text-muted-foreground">Linked to:</span>
          <span className="truncate font-medium text-foreground">
            {linked.title}
          </span>
          <button
            type="button"
            onClick={() => setThreadObject(null)}
            aria-label="Unlink"
            className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : null}

      {navChanged ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          <span className="truncate">
            You&apos;re now viewing {currentObject.title}.
          </span>
          <button
            type="button"
            onClick={startNewThreadHere}
            className="ml-auto shrink-0 font-medium text-primary hover:underline"
          >
            Start a new thread here?
          </button>
        </div>
      ) : null}

      {orgRequired ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <h3 className="text-sm font-medium text-foreground">
            Organization required
          </h3>
          <p className="text-sm text-muted-foreground">
            Join or create an organization to use the agent.
          </p>
        </div>
      ) : (
        <>
          <Conversation className="flex-1">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  title="Ask the agent"
                  description="It reads your board and proposes changes for you to review."
                  icon={<Sparkles className="size-5" />}
                >
                  <div className="mt-3 flex flex-col gap-2">
                    {suggestionsFor(linked).map((text) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => setDraft(text)}
                        className="rounded-md border border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </ConversationEmptyState>
              ) : (
                messages.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {message.parts.map((part, index) =>
                        renderPart(part, `${message.id}-${index}`, workspace),
                      )}
                    </MessageContent>
                  </Message>
                ))
              )}

              {error && !orgRequired ? (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <span className="flex-1">Something went wrong.</span>
                  <button
                    type="button"
                    onClick={() => {
                      // The failure re-surfaces through useChat's `error` state;
                      // swallow the rejection so it isn't an unhandled promise.
                      regenerate().catch(() => {});
                    }}
                    className="font-medium hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="shrink-0 border-t border-border p-3">
            <PromptInput onSubmit={submit}>
              <PromptInputBody>
                <PromptInputTextarea
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  placeholder="Ask the agent to read the board or propose a change…"
                />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputTools />
                <PromptInputSubmit
                  status={status}
                  onStop={stop}
                  disabled={!isStreaming && draft.trim().length === 0}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </>
      )}
    </aside>
  );
}
