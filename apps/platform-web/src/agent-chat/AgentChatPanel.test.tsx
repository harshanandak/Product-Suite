import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentLinkedObject } from "@/data/agent/transport";

// ---- threads adapter: controllable per test --------------------------------
const threadsAdapter = {
  list: vi.fn(async () => [] as unknown[]),
  messages: vi.fn(async () => [] as unknown[]),
  archive: vi.fn(async () => {}),
};
vi.mock("@/data/agent/threads", () => ({
  createAgentThreadsAdapter: () => threadsAdapter,
}));

// ---- useChat: fully controllable per test ----------------------------------
interface ChatStub {
  messages: unknown[];
  status: string;
  error: Error | undefined;
  sendMessage: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  setMessages: ReturnType<typeof vi.fn>;
}
let chat: ChatStub;
vi.mock("@ai-sdk/react", () => ({ useChat: () => chat }));

// ---- vendored AI Elements: light stand-ins (avoid ResizeObserver etc.) ------
vi.mock("@product-suite/ui-chat/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConversationEmptyState: ({
    title,
    description,
    children,
  }: {
    title?: string;
    description?: string;
    children?: ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      <span>{description}</span>
      {children}
    </div>
  ),
  ConversationScrollButton: () => null,
}));
vi.mock("@product-suite/ui-chat/components/ai-elements/message", () => ({
  Message: ({ from, children }: { from: string; children: ReactNode }) => (
    <div data-role={from}>{children}</div>
  ),
  MessageContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageResponse: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@product-suite/ui-chat/components/ai-elements/prompt-input", () => ({
  PromptInput: ({
    onSubmit,
    children,
  }: {
    onSubmit: (m: { text: string; files: unknown[] }, e: unknown) => void;
    children: ReactNode;
  }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const textarea = event.currentTarget.querySelector("textarea");
        onSubmit({ text: textarea?.value ?? "", files: [] }, event);
      }}
    >
      {children}
    </form>
  ),
  PromptInputBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PromptInputTextarea: (props: Record<string, unknown>) => (
    <textarea aria-label="Message" {...props} />
  ),
  PromptInputFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PromptInputTools: () => null,
  PromptInputSubmit: ({
    status,
    onStop,
    disabled,
  }: {
    status?: string;
    onStop?: () => void;
    disabled?: boolean;
  }) => {
    const generating = status === "streaming" || status === "submitted";
    return (
      <button
        type={generating ? "button" : "submit"}
        disabled={disabled}
        aria-label={generating ? "Stop" : "Submit"}
        onClick={generating ? onStop : undefined}
      >
        go
      </button>
    );
  },
}));

// The inline ProposalCard + ChatPendingSection navigate programmatically; stub
// useNavigate (and keep the Link stub for any remaining anchor usage).
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children: ReactNode;
  } & Record<string, unknown>) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    if (search) href += `?${new URLSearchParams(search).toString()}`;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

// The panel now mounts ChatPendingSection (useProposals) and the inline card
// (useProposalActions). Stub the data seam so the section stays empty/hidden and
// the inline card renders in its idle affordance without a live repository.
vi.mock("@/data/proposals", () => ({
  useProposals: () => ({
    proposals: [],
    isLoading: false,
    isRefetching: false,
    error: null,
    accept: vi.fn(),
    reject: vi.fn(),
    activeRules: vi.fn(async () => []),
    isMutating: false,
    refetch: vi.fn(),
  }),
  useProposalActions: () => ({
    phase: "idle",
    result: null,
    busy: false,
    error: null,
    accept: vi.fn(),
    reject: vi.fn(),
    reset: vi.fn(),
  }),
}));

import { AgentChatPanel } from "./AgentChatPanel";

const screenObject: AgentLinkedObject = {
  type: "screen",
  id: "/w/befach-hq/workboard",
  title: "My items",
};
const itemObject: AgentLinkedObject = {
  type: "work_item",
  id: "wi_1",
  title: "Ship auth",
};

function renderPanel(
  props: Partial<ComponentProps<typeof AgentChatPanel>> = {},
) {
  return render(
    <AgentChatPanel
      open
      onClose={vi.fn()}
      workspace="befach-hq"
      currentObject={screenObject}
      getToken={async () => "tok"}
      {...props}
    />,
  );
}

beforeEach(() => {
  chat = {
    messages: [],
    status: "ready",
    error: undefined,
    // sendMessage/regenerate return promises in the real useChat — mirror that so
    // the panel's `.catch()` / returned-promise handling is exercised faithfully.
    sendMessage: vi.fn(async () => {}),
    stop: vi.fn(),
    regenerate: vi.fn(async () => {}),
    setMessages: vi.fn(),
  };
  threadsAdapter.list.mockReset().mockResolvedValue([]);
  threadsAdapter.messages.mockReset().mockResolvedValue([]);
  threadsAdapter.archive.mockReset().mockResolvedValue(undefined);
});

describe("AgentChatPanel", () => {
  it("stays unmounted (renders nothing) when closed", () => {
    const { container } = renderPanel({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows board-scoped suggestion chips in the empty state", () => {
    renderPanel();
    expect(
      screen.getByText("What's on the board right now?"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /board|stale|proposal/i }).length).toBeGreaterThanOrEqual(3);
  });

  it("shows work-item-aware suggestions when linked to an item", () => {
    renderPanel({ currentObject: itemObject });
    expect(
      screen.getByText('Summarize "Ship auth" and suggest next steps'),
    ).toBeInTheDocument();
  });

  it("seeds the input when a suggestion chip is clicked", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Find stale work items to clean up"));
    expect(screen.getByLabelText("Message")).toHaveValue(
      "Find stale work items to clean up",
    );
  });

  it("focuses (and optionally seeds) the input on a focus request", () => {
    renderPanel({ focusRequest: { nonce: 1, prompt: "Draft a summary" } });
    const input = screen.getByLabelText("Message");
    expect(input).toHaveValue("Draft a summary");
    expect(input).toHaveFocus();
  });

  it("re-focuses the input on a new request while already open (no close)", () => {
    const { rerender } = renderPanel({ focusRequest: { nonce: 1 } });
    const input = screen.getByLabelText("Message");
    expect(input).toHaveFocus();
    input.blur();
    expect(input).not.toHaveFocus();

    // A second "Ask agent" invocation bumps the nonce; the panel must re-focus
    // the input, NOT toggle itself closed (it stays mounted the whole time).
    rerender(
      <AgentChatPanel
        open
        onClose={vi.fn()}
        workspace="befach-hq"
        currentObject={screenObject}
        getToken={async () => "tok"}
        focusRequest={{ nonce: 2 }}
      />,
    );
    expect(screen.getByLabelText("Message")).toHaveFocus();
  });

  it("shows a human tool-verb while a read tool is in flight", () => {
    chat.messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-list_work_items",
            toolCallId: "c1",
            state: "input-available",
            input: {},
          },
        ],
      },
    ];
    renderPanel();
    expect(screen.getByText("Reading the board…")).toBeInTheDocument();
  });

  it("renders a ProposalCard when a propose tool completes", () => {
    chat.messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-propose_create",
            toolCallId: "c1",
            state: "output-available",
            input: { title: "Ship auth", rationale: "User asked." },
            output: { proposed: true, proposal_id: "p_1" },
          },
        ],
      },
    ];
    renderPanel();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Ship auth")).toBeInTheDocument();
    // The card is now ACTIONABLE IN PLACE — an inline Accept, not a deep link out.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Review in Inbox/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a quiet failure line (not an endless spinner) when a propose tool errors", () => {
    chat.messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-propose_create",
            toolCallId: "c1",
            state: "output-error",
            input: { title: "Ship auth" },
            errorText: "input validation failed",
          },
        ],
      },
    ];
    renderPanel();
    expect(
      screen.getByText(/couldn't queue that proposal/i),
    ).toBeInTheDocument();
    // The "Drafting a proposal…" spinner must NOT linger on a failed tool call.
    expect(screen.queryByText("Drafting a proposal…")).not.toBeInTheDocument();
  });

  it("shows a friendly org-required panel on 403, with no input", () => {
    chat.error = new Error('{"error":"No active organization"}');
    renderPanel();
    expect(screen.getByText("Organization required")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });

  it("offers Retry on a generic error, wired to regenerate", () => {
    chat.error = new Error("stream failed");
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(chat.regenerate).toHaveBeenCalledTimes(1);
  });

  it("shows a Stop control while streaming, wired to stop()", () => {
    chat.status = "streaming";
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(chat.stop).toHaveBeenCalledTimes(1);
  });

  it("sends the typed message and clears the input", () => {
    renderPanel();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "list my work items" } });
    fireEvent.submit(textarea.closest("form")!);
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "list my work items" });
    expect(textarea).toHaveValue("");
  });

  it("shows the linked chip and unlinks on click", () => {
    renderPanel({ currentObject: itemObject });
    expect(screen.getByText("Linked to:")).toBeInTheDocument();
    expect(screen.getByText("Ship auth")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(screen.queryByText("Linked to:")).not.toBeInTheDocument();
  });

  it("offers a new-thread affordance when the screen changes, not auto-switching", () => {
    const { rerender } = renderPanel({ currentObject: itemObject });
    // Navigate to a different object; the thread stays linked to the first.
    rerender(
      <AgentChatPanel
        open
        onClose={vi.fn()}
        workspace="befach-hq"
        currentObject={{ type: "work_item", id: "wi_2", title: "Billing" }}
        getToken={async () => "tok"}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Start a new thread here/ }),
    ).toBeInTheDocument();
    // Still linked to the ORIGINAL object (no silent rewrite).
    expect(screen.getByText("Ship auth")).toBeInTheDocument();
  });

  it("opens the thread switcher and loads the org's threads", async () => {
    threadsAdapter.list.mockResolvedValueOnce([
      { id: "th_1", title: "Ship auth thread", linked_object: null, updated_at: "x" },
    ]);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Show threads" }));
    expect(threadsAdapter.list).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Ship auth thread")).toBeInTheDocument();
  });

  it("loads a selected thread's reconstructed history into the chat", async () => {
    threadsAdapter.list.mockResolvedValueOnce([
      { id: "th_1", title: "T1", linked_object: null, updated_at: "x" },
    ]);
    threadsAdapter.messages.mockResolvedValueOnce([
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Show threads" }));
    fireEvent.click(await screen.findByText("T1"));
    await waitFor(() => expect(threadsAdapter.messages).toHaveBeenCalledWith("th_1"));
    // The prior thread's stream is aborted before the selected history loads in.
    expect(chat.stop).toHaveBeenCalled();
    expect(chat.setMessages).toHaveBeenCalledWith([
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("New thread aborts any in-flight stream and resets to a fresh, unsaved thread", () => {
    chat.status = "streaming";
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    // stop() first so the previous turn can't stream its response into the new thread.
    expect(chat.stop).toHaveBeenCalled();
    expect(chat.setMessages).toHaveBeenCalledWith([]);
  });

  it("clears the thread list on remount (the shell's org-switch key), no cross-tenant carryover", async () => {
    threadsAdapter.list.mockResolvedValue([
      { id: "th_1", title: "T1", linked_object: null, updated_at: "x" },
    ]);
    const { unmount } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Show threads" }));
    expect(await screen.findByText("T1")).toBeInTheDocument();
    // Simulate the shell remounting the panel on an org switch (`key={orgId}`): a
    // fresh instance starts with the switcher closed and no carried-over threads.
    unmount();
    renderPanel();
    expect(screen.queryByText("T1")).not.toBeInTheDocument();
  });

  it("closes on the X button and on Escape", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close agent chat" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(globalThis.window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
