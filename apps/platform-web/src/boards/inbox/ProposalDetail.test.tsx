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

// The detail fetches the run's active rules through the proposals hook; stub
// `activeRules` so the provenance badge is deterministic (default: none).
const proposalsMock = vi.hoisted(() => ({
  activeRules: vi.fn(async (_id: string) => [] as { id: string; title: string }[]),
}));
vi.mock("@/data/proposals", () => ({
  useProposals: () => ({ activeRules: proposalsMock.activeRules }),
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
    accept: (
      id: string,
      editedPayload?: Record<string, unknown>,
    ) => Promise<AcceptResult>;
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
    expect(accept).toHaveBeenCalledWith("p1", undefined);
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
    expect(accept).toHaveBeenCalledWith("p1", undefined);
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

  it("(memory) Accept success shows 'Memory logged.' linking to the decision log, NOT the work-item route", async () => {
    itemsMock.items = [];
    const accept = vi.fn(
      async (): Promise<AcceptResult> => ({
        outcome: "applied",
        // The applied row is a memory uuid — it must NOT be routed as a work item.
        item: { id: "3f2a-mem-uuid" } as WorkItem,
      }),
    );
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: null,
        operation: "create",
        payload: { kind: "decision", title: "Use Postgres" },
      }),
      { accept },
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(screen.getByText(/Memory logged\./)).toBeInTheDocument(),
    );
    const link = screen.getByRole("link", { name: /memory log/i });
    expect(link).toHaveAttribute("href", "/w/acme/memory");
    // The dead work-item link is never rendered for a memory.
    expect(screen.queryByRole("link", { name: /View item/ })).not.toBeInTheDocument();
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

  it("(memory retract) fetches the target and shows its TITLE in the header, not the raw uuid", async () => {
    itemsMock.items = [];
    memoryMock.get.mockResolvedValueOnce({
      memory: { id: "3f2a-mem", title: "Use Postgres", body: "", topics: [] } as unknown,
      chain: [],
    });
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: "3f2a-mem",
        operation: "retract",
        payload: {},
      }),
    );
    // The destructive op is identified by the memory's title, not the opaque uuid.
    await waitFor(() =>
      expect(screen.getByText(/Retract “Use Postgres”/)).toBeInTheDocument(),
    );
    expect(memoryMock.get).toHaveBeenCalledWith("3f2a-mem");
  });

  it("(memory supersede) Accept success reports 'Memory updated.' (op-specific, not 'logged')", async () => {
    itemsMock.items = [];
    memoryMock.get.mockResolvedValueOnce({
      memory: { id: "mem_1", title: "Use Postgres", body: "", topics: [] } as unknown,
      chain: [],
    });
    const accept = vi.fn(
      async (): Promise<AcceptResult> => ({
        outcome: "applied",
        item: { id: "mem-uuid" } as WorkItem,
      }),
    );
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: "mem_1",
        operation: "supersede",
        payload: { change_reason: "switched", title: "Use MongoDB" },
      }),
      { accept },
    );
    // Accept is only live once the target has loaded (see the gating test below).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(screen.getByText(/Memory updated\./)).toBeInTheDocument(),
    );
    // NEVER the create wording, never the dead work-item link.
    expect(screen.queryByText(/Memory logged\./)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View item/ })).not.toBeInTheDocument();
  });

  it("(memory supersede) Accept is DISABLED until the target memory loads", async () => {
    itemsMock.items = [];
    // Hold the target fetch open so the pane sits in its loading state.
    let resolveGet: (value: { memory: unknown; chain: never[] }) => void = () => {};
    memoryMock.get.mockImplementationOnce(
      () =>
        new Promise<{ memory: unknown; chain: never[] }>((resolve) => {
          resolveGet = resolve;
        }),
    );
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: "mem_1",
        operation: "supersede",
        payload: { change_reason: "switched", title: "Use MongoDB" },
      }),
    );
    // While the target is in flight: Accept disabled + a loading hint — a supersede must
    // never be applied against an unresolved (possibly stale) target.
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByText(/Loading the target memory/)).toBeInTheDocument();
    // Once it resolves, Accept re-enables and the hint clears.
    resolveGet({
      memory: { id: "mem_1", title: "Use Postgres", body: "", topics: [] } as unknown,
      chain: [],
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled(),
    );
    expect(screen.queryByText(/Loading the target memory/)).not.toBeInTheDocument();
  });

  it("(memory rule) shows 'applies when' + evidence + strength controls; banner says the rule is saved", async () => {
    itemsMock.items = [];
    const accept = vi.fn(
      async (): Promise<AcceptResult> => ({
        outcome: "applied",
        item: { id: "rule-uuid" } as WorkItem,
      }),
    );
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: null,
        operation: "create",
        payload: {
          kind: "rule",
          title: "Prefer concise titles",
          attrs: {
            applies_when: "work items in project Foo",
            evidence_proposal_ids: ["p1", "p2", "p3"],
          },
          enforcement: "advisory",
        },
      }),
      { accept },
    );
    expect(
      screen.getAllByText(/work items in project Foo/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/You made this same edit 3 times/i)).toBeInTheDocument();
    const acceptBtn = screen.getByRole("button", { name: "Accept rule" });
    expect(acceptBtn).toBeEnabled();
    fireEvent.click(acceptBtn);
    await waitFor(() =>
      expect(
        screen.getByText(/Rule saved — the agent follows it from now on\./),
      ).toBeInTheDocument(),
    );
  });

  it("(memory rule) offers rule-shaped reject reason chips", () => {
    itemsMock.items = [];
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: null,
        operation: "create",
        payload: {
          kind: "rule",
          title: "Prefer concise titles",
          attrs: { applies_when: "x", evidence_proposal_ids: ["p1"] },
          enforcement: "advisory",
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("button", { name: "too broad" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "not what I meant" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "don't make this a rule" }),
    ).toBeInTheDocument();
    // The work-item chips are NOT offered for a rule.
    expect(
      screen.queryByRole("button", { name: "wrong target" }),
    ).not.toBeInTheDocument();
  });

  it("(memory rule) toggling hard writes the FULL merged edited_payload on accept", async () => {
    itemsMock.items = [];
    const accept = vi.fn(
      async (
        _id: string,
        _editedPayload?: Record<string, unknown>,
      ): Promise<AcceptResult> => ({
        outcome: "applied",
        item: { id: "r" } as WorkItem,
      }),
    );
    const original = {
      kind: "rule",
      title: "Prefer concise titles",
      attrs: { applies_when: "x", evidence_proposal_ids: ["p1", "p2"] },
      enforcement: "advisory",
    };
    renderDetail(
      proposal({ target_type: "memory", operation: "create", payload: original }),
      { accept },
    );
    fireEvent.click(screen.getByRole("button", { name: /always follow/i }));
    fireEvent.click(screen.getByRole("button", { name: "Accept rule" }));
    // accept is called with the proposal id AND a full merged edited_payload
    // (kind + title preserved — never a partial that would drop them).
    await waitFor(() => expect(accept).toHaveBeenCalled());
    const editedArg = accept.mock.calls[0]![1];
    expect(editedArg).toMatchObject({
      kind: "rule",
      title: "Prefer concise titles",
      enforcement: "hard",
    });
  });

  it("(work-item) renders 'Rules active during this run' with the fetched rule titles", async () => {
    itemsMock.items = [];
    proposalsMock.activeRules.mockResolvedValueOnce([
      { id: "m_1", title: "Prefer concise titles" },
    ]);
    renderDetail(proposal());
    await waitFor(() =>
      expect(
        screen.getByText(/Rules active during this run:/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Prefer concise titles/)).toBeInTheDocument();
    expect(proposalsMock.activeRules).toHaveBeenCalledWith("p1");
  });

  it("(work-item) renders no rule badge when the run had no active rules", async () => {
    itemsMock.items = [];
    proposalsMock.activeRules.mockResolvedValueOnce([]);
    renderDetail(proposal());
    // Let the (empty) fetch settle, then assert the badge is absent.
    await waitFor(() => expect(proposalsMock.activeRules).toHaveBeenCalledWith("p1"));
    expect(
      screen.queryByText(/Rules active during this run:/),
    ).not.toBeInTheDocument();
  });

  it("(memory) never fetches active rules (only work-item proposals show the badge)", () => {
    itemsMock.items = [];
    proposalsMock.activeRules.mockClear();
    renderDetail(
      proposal({
        target_type: "memory",
        target_id: null,
        operation: "create",
        payload: { kind: "decision", title: "Use Postgres" },
      }),
    );
    expect(proposalsMock.activeRules).not.toHaveBeenCalled();
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
