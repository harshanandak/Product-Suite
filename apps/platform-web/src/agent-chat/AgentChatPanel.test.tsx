import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentLinkedObject } from "@/data/agent/transport";

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

// ProposalCard renders a TanStack Link; stub it as a plain anchor.
vi.mock("@tanstack/react-router", () => ({
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

import { AgentChatPanel, isOrgRequiredError } from "./AgentChatPanel";

const screenObject: AgentLinkedObject = {
  type: "screen",
  id: "/w/befach-hq/workboard",
  title: "Work items",
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
});

describe("isOrgRequiredError", () => {
  it("is true for the backend's 403 no-org body", () => {
    expect(
      isOrgRequiredError(new Error('{"error":"No active organization"}')),
    ).toBe(true);
  });
  it("is false for other errors / undefined", () => {
    expect(isOrgRequiredError(new Error("network down"))).toBe(false);
    expect(isOrgRequiredError(undefined)).toBe(false);
  });
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
    expect(
      screen.getByRole("link", { name: /Review in Inbox/ }),
    ).toHaveAttribute("href", "/w/befach-hq/inbox?proposal=p_1");
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

  it("closes on the X button and on Escape", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close agent chat" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(globalThis.window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
