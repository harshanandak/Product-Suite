import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MeetingActionsRepository } from "@/data/meeting-actions";
import type { MeetingActionCandidate } from "@/data/meeting-actions";

// The screen reads the workspace from the route and renders TanStack `Link`s. The
// stub SERIALIZES `to`/`params`/`search` into a real href, so a link assertion
// pins what the screen actually asked the router for — not just that an anchor
// exists.
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ workspace: "acme" }),
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  } & Record<string, unknown>) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    const query = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={query ? `${href}?${query}` : href} {...rest}>
        {children}
      </a>
    );
  },
}));

import { MeetingTriageScreen } from "./MeetingTriageScreen";

function candidate(
  overrides: Partial<MeetingActionCandidate> = {},
): MeetingActionCandidate {
  return {
    id: "ai_1",
    meeting_id: "mtg_1",
    text: "Send the revised quote to Acme",
    confidence: 0.82,
    promotion_reason: "Explicit commitment",
    created_at: "2026-07-25T00:00:00.000Z",
    promotion_state: "unpromoted",
    proposal_id: null,
    work_item_id: null,
    ...overrides,
  };
}

function repoWith(candidates: MeetingActionCandidate[]): MeetingActionsRepository {
  return { list: vi.fn(async () => candidates) };
}

describe("MeetingTriageScreen", () => {
  it("shows a loading skeleton while the first read is in flight", () => {
    const repository: MeetingActionsRepository = {
      // Never settles, so the first read stays in flight for the assertion.
      list: vi.fn(() => new Promise<MeetingActionCandidate[]>(() => {})),
    };

    render(<MeetingTriageScreen repository={repository} />);

    expect(screen.getByLabelText("Loading meeting action items")).toBeInTheDocument();
  });

  it("shows the empty state when this org has no promoted action items", async () => {
    render(<MeetingTriageScreen repository={repoWith([])} />);

    expect(
      await screen.findByText("No meeting action items to triage"),
    ).toBeInTheDocument();
  });

  it("shows the error state with the API's message, and a retry", async () => {
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => {
        throw new Error("Not a member of that organization");
      }),
    };

    render(<MeetingTriageScreen repository={repository} />);

    expect(
      await screen.findByText("Couldn't load meeting action items"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not a member of that organization"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("retrying after an error re-reads the repository", async () => {
    let shouldFail = true;
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => {
        if (shouldFail) throw new Error("boom");
        return [candidate({ text: "Recovered item" })];
      }),
    };

    render(<MeetingTriageScreen repository={repository} />);
    const retry = await screen.findByRole("button", { name: "Try again" });

    shouldFail = false;
    retry.click();

    expect(await screen.findByText("Recovered item")).toBeInTheDocument();
  });

  it("renders each candidate's text with its promotion state", async () => {
    render(
      <MeetingTriageScreen
        repository={repoWith([
          candidate({ id: "a", text: "Not proposed yet", promotion_state: "unpromoted" }),
          candidate({
            id: "b",
            text: "Awaiting review",
            promotion_state: "proposal_pending",
            proposal_id: "p_b",
          }),
          candidate({
            id: "c",
            text: "Already on the board",
            promotion_state: "accepted",
            proposal_id: "p_c",
            work_item_id: "wi_c",
          }),
          candidate({
            id: "d",
            text: "Turned down",
            promotion_state: "dismissed",
            proposal_id: "p_d",
          }),
        ])}
      />,
    );

    expect(await screen.findByText("Not proposed yet")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText("Already on the board")).toBeInTheDocument();
    expect(screen.getByText("Turned down")).toBeInTheDocument();

    expect(screen.getByText("Not proposed")).toBeInTheDocument();
    expect(screen.getByText("Proposal pending")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Dismissed")).toBeInTheDocument();
  });

  it("renders a neutral badge for a promotion state it does not recognize", async () => {
    render(
      <MeetingTriageScreen
        repository={repoWith([
          candidate({ text: "From a newer backend", promotion_state: "unknown" }),
        ])}
      />,
    );

    expect(await screen.findByText("Unknown state")).toBeInTheDocument();
    // Never rendered as a link — we don't know where an unrecognized state points.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links an accepted candidate to its work item", async () => {
    render(
      <MeetingTriageScreen
        repository={repoWith([
          candidate({
            text: "Already on the board",
            promotion_state: "accepted",
            proposal_id: "p_c",
            work_item_id: "wi_c",
          }),
        ])}
      />,
    );

    const link = await screen.findByRole("link", { name: /work item/i });
    expect(link).toHaveAttribute("href", "/w/acme/workboard/item/wi_c");
  });

  it("links a pending candidate to its proposal in the Inbox", async () => {
    render(
      <MeetingTriageScreen
        repository={repoWith([
          candidate({
            text: "Awaiting review",
            promotion_state: "proposal_pending",
            proposal_id: "p_b",
          }),
        ])}
      />,
    );

    const link = await screen.findByRole("link", { name: /inbox/i });
    expect(link).toHaveAttribute("href", "/w/acme/inbox?proposal=p_b");
  });

  it("defaults the repository to the shared singleton when no prop is given", async () => {
    // The InboxScreen seam: the prop is for tests; the app gets the singleton.
    render(<MeetingTriageScreen />);

    await waitFor(() =>
      expect(
        screen.queryByLabelText("Loading meeting action items"),
      ).not.toBeInTheDocument(),
    );
    // The fixture store resolves, so the list heading renders rather than an error.
    expect(screen.getByRole("heading", { name: "Meeting triage" })).toBeInTheDocument();
  });
});
