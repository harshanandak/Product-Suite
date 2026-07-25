import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { MeetingActionsRepository } from "@/data/meeting-actions";
import type {
  MeetingActionCandidate,
  MeetingSyncSummary,
} from "@/data/meeting-actions";

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

const EMPTY_SUMMARY = {
  proposalsCreated: 0,
  skippedDuplicate: 0,
  skippedUnmappedTenant: 0,
};

function repoWith(candidates: MeetingActionCandidate[]): MeetingActionsRepository {
  return {
    list: vi.fn(async () => candidates),
    sync: vi.fn(async () => EMPTY_SUMMARY),
  };
}

describe("MeetingTriageScreen", () => {
  it("shows a loading skeleton while the first read is in flight", () => {
    const repository: MeetingActionsRepository = {
      // Never settles, so the first read stays in flight for the assertion.
      list: vi.fn(() => new Promise<MeetingActionCandidate[]>(() => {})),
      sync: vi.fn(async () => EMPTY_SUMMARY),
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
      sync: vi.fn(async () => EMPTY_SUMMARY),
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
      sync: vi.fn(async () => EMPTY_SUMMARY),
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

  it("renders no Inbox link for a candidate with no proposal", async () => {
    render(
      <MeetingTriageScreen
        repository={repoWith([
          candidate({
            text: "Nothing proposed yet",
            promotion_state: "unpromoted",
            proposal_id: null,
          }),
        ])}
      />,
    );

    await screen.findByText("Nothing proposed yet");
    expect(screen.queryByRole("link", { name: /inbox/i })).not.toBeInTheDocument();
  });

  it("renders no Inbox link for a dismissed candidate", async () => {
    // Its proposal exists, but the human already said no — offering "review this"
    // would reopen a question they answered.
    render(
      <MeetingTriageScreen
        repository={repoWith([
          candidate({
            text: "Turned down",
            promotion_state: "dismissed",
            proposal_id: "p_d",
          }),
        ])}
      />,
    );

    await screen.findByText("Turned down");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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

describe("MeetingTriageScreen — Sync now", () => {
  it("syncs exactly once per click", async () => {
    const repository = repoWith([candidate({ text: "An action item" })]);
    render(<MeetingTriageScreen repository={repository} />);

    const button = await screen.findByRole("button", { name: "Sync now" });
    fireEvent.click(button);

    await waitFor(() => expect(repository.sync).toHaveBeenCalledTimes(1));
  });

  it("is disabled while the sync is in flight, so a double-click cannot double-ingest", async () => {
    let release: (() => void) | undefined;
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => [candidate({ text: "An action item" })]),
      sync: vi.fn(
        () =>
          new Promise<MeetingSyncSummary>((resolve) => {
            release = () => resolve(EMPTY_SUMMARY);
          }),
      ),
    };
    render(<MeetingTriageScreen repository={repository} />);

    const button = await screen.findByRole("button", { name: /sync/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    // The click a user would land while it spins must not reach the endpoint.
    fireEvent.click(button);
    expect(repository.sync).toHaveBeenCalledTimes(1);

    release?.();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("refetches on success, so newly-proposed candidates show as pending", async () => {
    let synced = false;
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () =>
        synced
          ? [
              candidate({
                text: "An action item",
                promotion_state: "proposal_pending",
                proposal_id: "p_new",
              }),
            ]
          : [candidate({ text: "An action item", promotion_state: "unpromoted" })],
      ),
      sync: vi.fn(async () => {
        synced = true;
        return { ...EMPTY_SUMMARY, proposalsCreated: 1 };
      }),
    };
    render(<MeetingTriageScreen repository={repository} />);

    expect(await screen.findByText("Not proposed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

    expect(await screen.findByText("Proposal pending")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /inbox/i });
    expect(link).toHaveAttribute("href", "/w/acme/inbox?proposal=p_new");
  });

  it("surfaces a sync failure without swallowing it, and leaves the list unchanged", async () => {
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => [candidate({ text: "An action item" })]),
      sync: vi.fn(async () => {
        throw new Error("Ambiguous organization; specify org_id");
      }),
    };
    render(<MeetingTriageScreen repository={repository} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(
      await screen.findByText("Ambiguous organization; specify org_id"),
    ).toBeInTheDocument();
    // The list the user is reading survives a failed write.
    expect(screen.getByText("An action item")).toBeInTheDocument();
    expect(screen.getByText("Not proposed")).toBeInTheDocument();
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it("offers Sync now on the empty state too — that is how the first items arrive", async () => {
    // With no candidates yet, a sync is the ONLY way to get any; hiding the button
    // behind a non-empty list would make the empty state a dead end.
    const repository = repoWith([]);
    render(<MeetingTriageScreen repository={repository} />);

    const button = await screen.findByRole("button", { name: "Sync now" });
    fireEvent.click(button);

    await waitFor(() => expect(repository.sync).toHaveBeenCalledTimes(1));
  });
});
