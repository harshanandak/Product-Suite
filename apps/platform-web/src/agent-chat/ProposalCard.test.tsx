import { render, screen } from "@testing-library/react";
import type { ToolUIPart } from "ai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Stub TanStack Link as a plain anchor that serializes to/params/search into an
// href, so the deep-link target is assertable without a full router.
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

import { ProposalCard, proposalCardFromToolPart } from "./ProposalCard";

function toolPart(part: Partial<ToolUIPart> & { type: string }): ToolUIPart {
  return part as ToolUIPart;
}

describe("proposalCardFromToolPart", () => {
  it("extracts a create card from the tool input + proposal_id", () => {
    const data = proposalCardFromToolPart(
      toolPart({
        type: "tool-propose_create",
        state: "output-available",
        input: { title: "Ship auth", rationale: "The user asked for it." },
        output: { proposed: true, proposal_id: "p_1" },
      }),
    );
    expect(data).toEqual({
      operation: "create",
      proposalId: "p_1",
      title: "Ship auth",
      summary: "The user asked for it.",
    });
  });

  it("falls back to the description for a create summary when no rationale", () => {
    const data = proposalCardFromToolPart(
      toolPart({
        type: "tool-propose_create",
        state: "output-available",
        input: { title: "Ship auth", description: "OAuth login flow." },
        output: { proposed: true, proposal_id: "p_2" },
      }),
    );
    expect(data?.summary).toBe("OAuth login flow.");
  });

  it("extracts an update card, titling from the patch when present", () => {
    const data = proposalCardFromToolPart(
      toolPart({
        type: "tool-propose_update",
        state: "output-available",
        input: {
          id: "wi_9",
          patch: { title: "Renamed task" },
          rationale: "Clearer name.",
        },
        output: { proposed: true, proposal_id: "p_3" },
      }),
    );
    expect(data).toEqual({
      operation: "update",
      proposalId: "p_3",
      title: "Renamed task",
      summary: "Clearer name.",
    });
  });

  it("titles an update generically (never a raw uuid) when the patch has no title", () => {
    const data = proposalCardFromToolPart(
      toolPart({
        type: "tool-propose_update",
        state: "output-available",
        input: { id: "wi_9", patch: { priority: "high" } },
        output: { proposed: true, proposal_id: "p_4" },
      }),
    );
    // The raw target uuid is noise in the transcript — the Inbox shows the real
    // target. Assert the generic label and that the uuid never leaks in.
    expect(data?.title).toBe("Proposed update");
    expect(data?.title).not.toContain("wi_9");
  });

  it("returns null for a non-propose tool", () => {
    expect(
      proposalCardFromToolPart(
        toolPart({
          type: "tool-list_work_items",
          state: "output-available",
          input: {},
          output: [],
        }),
      ),
    ).toBeNull();
  });

  it("returns null while the proposal is still running (no output yet)", () => {
    expect(
      proposalCardFromToolPart(
        toolPart({
          type: "tool-propose_create",
          state: "input-available",
          input: { title: "Ship auth" },
        }),
      ),
    ).toBeNull();
  });

  it("returns null for a refusal (proposed: false)", () => {
    expect(
      proposalCardFromToolPart(
        toolPart({
          type: "tool-propose_create",
          state: "output-available",
          input: { title: "Ship auth" },
          output: { proposed: false, error: "could not create proposal" },
        }),
      ),
    ).toBeNull();
  });
});

describe("ProposalCard", () => {
  const data = {
    operation: "create" as const,
    proposalId: "p_1",
    title: "Ship auth",
    summary: "The user asked for it.",
  };

  it("renders the badge, title, summary, pending pill, and NO accept control", () => {
    render(<ProposalCard data={data} workspace="befach-hq" />);
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Ship auth")).toBeInTheDocument();
    expect(screen.getByText("The user asked for it.")).toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    // The stance is sacred: no accept/apply button lives in the chat card.
    expect(
      screen.queryByRole("button", { name: /accept|apply/i }),
    ).not.toBeInTheDocument();
  });

  it("deep-links Review in Inbox to the proposal's detail pane", () => {
    render(<ProposalCard data={data} workspace="befach-hq" />);
    const link = screen.getByRole("link", { name: /Review in Inbox/ });
    expect(link).toHaveAttribute(
      "href",
      "/w/befach-hq/inbox?proposal=p_1",
    );
  });

  it("labels an update card with the Update badge", () => {
    render(
      <ProposalCard
        data={{ ...data, operation: "update" }}
        workspace="befach-hq"
      />,
    );
    expect(screen.getByText("Update")).toBeInTheDocument();
  });
});
