import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AcceptResult, Proposal } from "@/data/proposals";
import type { WorkItem } from "@/data/work-items";

// The detail fetches the update target through the work-items hook; stub it with
// a controlled item set so the diff + operation sentence are deterministic.
const itemsMock = vi.hoisted(() => ({ items: [] as WorkItem[] }));
vi.mock("@/data/work-items", () => ({
  useWorkItems: () => ({ items: itemsMock.items }),
}));

// The memory surface fetches a supersede target through the memories hook; stub
// `get` so the current → proposed diff is deterministic.
const memoryMock = vi.hoisted(() => ({
  get: vi.fn(async (_id: string) => ({ memory: undefined as unknown, chain: [] })),
}));
vi.mock("@/data/memories", () => ({
  useMemories: () => ({ get: memoryMock.get }),
}));

// Render TanStack Link as a plain anchor so the detail can render without a router.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  } & Record<string, unknown>) => {
    const href = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to,
    );
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

import { ProposalDetail } from "./ProposalDetail";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: { title: "Ship pricing brief", priority: "high" },
    rationale: "Both calls surfaced pricing objections.",
    confidence: 0.82,
    status: "pending",
    run_id: "run_9f2a",
    model_id: "kimi-k2.5",
    created_at: "2026-07-13T09:12:00.000Z",
    ...overrides,
  };
}

const targetItem = {
  id: "wi_1",
  title: "Payments revamp",
  priority: "high",
  phase: "plan",
} as unknown as WorkItem;

function renderDetail(
  p: Proposal,
  handlers: Partial<{
    accept: (id: string) => Promise<AcceptResult>;
    reject: (id: string, reason?: string) => Promise<void>;
  }> = {},
) {
  const accept =
    handlers.accept ??
    vi.fn(async (): Promise<AcceptResult> => ({ outcome: "stale" }));
  const reject = handlers.reject ?? vi.fn(async () => undefined);
  render(
    <ProposalDetail
      proposal={p}
      accept={accept}
      reject={reject}
      isMutating={false}
      workspace="acme"
    />,
  );
  return { accept, reject };
}

describe("ProposalDetail", () => {
  it("(create) renders field | value rows and the create sentence", () => {
    itemsMock.items = [];
    renderDetail(proposal());
    expect(
      screen.getByText("Create work item “Ship pricing brief”"),
    ).toBeInTheDocument();
    // Rationale is shown verbatim.
    expect(
      screen.getByText("Both calls surfaced pricing objections."),
    ).toBeInTheDocument();
    // A row per provided field; no current column for a create.
    const title = screen.getByText("title");
    const row = title.closest("div");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("Ship pricing brief");
    expect(screen.getByText("priority")).toBeInTheDocument();
    expect(screen.queryByText("→")).not.toBeInTheDocument();
  });

  it("(update) renders current → proposed for ONLY the changed fields", () => {
    itemsMock.items = [targetItem];
    renderDetail(
      proposal({
        operation: "update",
        target_id: "wi_1",
        // priority changes high→critical; phase is unchanged (plan→plan).
        payload: { priority: "critical", phase: "plan" },
        rationale: "Escalated overnight.",
      }),
    );
    expect(
      screen.getByText("Update Payments revamp: 1 field"),
    ).toBeInTheDocument();
    const row = screen.getByText("priority").closest("div");
    expect(row).toHaveTextContent("high");
    expect(row).toHaveTextContent("critical");
    // The unchanged phase field is NOT shown.
    expect(screen.queryByText("phase")).not.toBeInTheDocument();
    // The arrow marks the current→proposed transition.
    expect(screen.getByText("→")).toBeInTheDocument();
    // Target link present.
    expect(
      screen.getByRole("link", { name: /View target item/ }),
    ).toHaveAttribute("href", "/w/acme/workboard/item/wi_1");
  });

  it("Accept surfaces a 409 stale outcome as a message (never silent)", async () => {
    const accept = vi.fn(
      async (): Promise<AcceptResult> => ({ outcome: "stale" }),
    );
    renderDetail(proposal(), { accept });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).toHaveBeenCalledWith("p1");
    await waitFor(() =>
      expect(
        screen.getByText(/no longer pending/i),
      ).toBeInTheDocument(),
    );
  });

  it("Accept surfaces a 422 invalid outcome as a message (never silent)", async () => {
    const accept = vi.fn(
      async (): Promise<AcceptResult> => ({ outcome: "invalid" }),
    );
    renderDetail(proposal(), { accept });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).toHaveBeenCalledWith("p1");
    await waitFor(() =>
      expect(
        screen.getByText(/rejected this proposal as invalid/i),
      ).toBeInTheDocument(),
    );
  });

  it("Accept success shows an Applied → view item link to the created item", async () => {
    const accept = vi.fn(
      async (): Promise<AcceptResult> => ({
        outcome: "applied",
        item: { id: "wi_9" } as WorkItem,
      }),
    );
    renderDetail(proposal(), { accept });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /View item/ }),
      ).toHaveAttribute("href", "/w/acme/workboard/item/wi_9"),
    );
  });

  it("Reject with a chip reason calls reject with that reason", () => {
    const reject = vi.fn(async () => undefined);
    renderDetail(proposal(), { reject });
    // Open the reason panel, pick a chip, confirm.
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "wrong target" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    expect(reject).toHaveBeenCalledWith("p1", "wrong target");
  });

  it("Reject with no reason calls reject with an undefined reason (skippable)", () => {
    const reject = vi.fn(async () => undefined);
    renderDetail(proposal(), { reject });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    expect(reject).toHaveBeenCalledWith("p1", undefined);
  });

  it("Accept transport error surfaces a VISIBLE banner (never a silent failure)", async () => {
    const accept = vi.fn(async (): Promise<AcceptResult> => {
      throw new Error("Server error (500)");
    });
    renderDetail(proposal(), { accept });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(screen.getByText("Server error (500)")).toBeInTheDocument(),
    );
    // Announced via the status role (the banner is an <output>, whose implicit
    // ARIA role is "status"), like WorkboardScreen's errors.
    expect(screen.getByRole("status")).toHaveTextContent("Server error (500)");
  });

  it("Reject transport error keeps the form OPEN with the reason intact (no false success)", async () => {
    const reject = vi.fn(async () => {
      throw new Error("Server error (500)");
    });
    renderDetail(proposal(), { reject });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "wrong target" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    await waitFor(() =>
      expect(screen.getByText("Server error (500)")).toBeInTheDocument(),
    );
    // Form stays open (confirm button still present) and the reason is preserved.
    expect(
      screen.getByRole("button", { name: "Reject proposal" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Rejection reason")).toHaveValue(
      "wrong target",
    );
  });

  it("Reject success shows a terminal Rejected state with NO live Accept/Reject buttons", async () => {
    const reject = vi.fn(async () => undefined);
    renderDetail(proposal(), { reject });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    await waitFor(() => expect(screen.getByText("Rejected.")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: "Accept" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
  });

  it("(memory create) renders the log sentence, body as primary, and a kind row", () => {
    itemsMock.items = [];
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: null,
        operation: "create",
        payload: {
          kind: "decision",
          title: "Use Postgres",
          body: "We picked Postgres over Mongo.",
          topics: ["db"],
        },
        rationale: "Recorded from the call.",
      }),
    );
    expect(screen.getByText("Log a decision: “Use Postgres”")).toBeInTheDocument();
    // The memory body is the primary content being logged.
    expect(screen.getByText("We picked Postgres over Mongo.")).toBeInTheDocument();
    // Kind + topics render as attribute rows.
    expect(screen.getByText("kind")).toBeInTheDocument();
    const kindRow = screen.getByText("kind").closest("div");
    expect(kindRow).toHaveTextContent("decision");
    expect(screen.getByText("topics")).toBeInTheDocument();
    // No work-item "View target item" link for a memory.
    expect(screen.queryByText(/View target item/)).not.toBeInTheDocument();
  });

  it("(memory supersede) shows change_reason + current → proposed from the fetched target", async () => {
    itemsMock.items = [];
    memoryMock.get.mockResolvedValueOnce({
      memory: {
        id: "mem_1",
        title: "Use Postgres",
        body: "We picked Postgres.",
        topics: ["db"],
      } as unknown,
      chain: [],
    });
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: "mem_1",
        operation: "supersede",
        payload: {
          change_reason: "Mongo was chosen instead",
          title: "Use MongoDB",
          body: "We switched to Mongo.",
        },
      }),
    );
    // The target fetch resolves → the sentence names the target and the diff fills.
    await waitFor(() =>
      expect(screen.getByText(/Supersede Use Postgres:/)).toBeInTheDocument(),
    );
    expect(memoryMock.get).toHaveBeenCalledWith("mem_1");
    expect(screen.getByText(/Mongo was chosen instead/)).toBeInTheDocument();
    // current → proposed for the overridden title.
    const titleRow = screen.getByText("title").closest("div");
    expect(titleRow).toHaveTextContent("Use Postgres");
    expect(titleRow).toHaveTextContent("Use MongoDB");
    expect(screen.getAllByText("→").length).toBeGreaterThan(0);
  });

  it("renders provenance fine-print and a collapsible raw payload", () => {
    itemsMock.items = [];
    renderDetail(proposal());
    expect(screen.getByText("kimi-k2.5")).toBeInTheDocument();
    expect(screen.getByText("run_9f2a")).toBeInTheDocument();
    // Raw payload is hidden until toggled.
    expect(screen.queryByText(/"title": "Ship pricing brief"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /raw payload/i }));
    expect(
      screen.getByText(/"title": "Ship pricing brief"/),
    ).toBeInTheDocument();
  });
});
