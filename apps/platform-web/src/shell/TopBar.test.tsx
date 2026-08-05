import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderWithRouter } from "../test/harness";
import { TopBar } from "./TopBar";

vi.mock("./UserMenu", () => ({
  UserMenu: () => null,
}));

// Controlled proposals hook so the badge count is deterministic. TopBar only
// pulls `useProposals` from the barrel; each test overrides `mockProposals`.
let mockProposals: { id: string }[] = [];
vi.mock("@/data/proposals", () => ({
  useProposals: () => ({ proposals: mockProposals, isLoading: false }),
}));

describe("TopBar", () => {
  it("hides the pending-proposal badge when there are none", async () => {
    mockProposals = [];
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        onOpenPalette={vi.fn()}
        onAskAgent={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    await screen.findByRole("button", { name: "Ask agent" });
    expect(screen.queryByLabelText(/pending proposals/)).not.toBeInTheDocument();
  });

  it("shows the pending-proposal count badge when there are proposals", async () => {
    mockProposals = [{ id: "a" }, { id: "b" }, { id: "c" }];
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        onOpenPalette={vi.fn()}
        onAskAgent={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    const queueLink = await screen.findByRole("link", { name: "Review inbox" });
    const descriptionId = queueLink.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(
      "3 pending proposals",
    );

    const badge = screen.getByText("3");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    // F1: the count must sit on the affordance that NAVIGATES to the queue it
    // counts — the Review inbox link — not on "Ask agent", which opens chat.
    expect(queueLink).toHaveAttribute("href", "/w/test-ws/inbox");
    // The badge is positioned against the queue link's own wrapper, and that
    // wrapper holds no other affordance — so the count decorates the thing that
    // navigates to the queue, and nothing else.
    const badgeWrapper = badge.parentElement;
    expect(badgeWrapper).toContainElement(queueLink);
    expect(badgeWrapper).not.toContainElement(
      screen.getByRole("button", { name: "Ask agent" }),
    );
  });

  it("caps the badge at 9+ when more than nine are pending", async () => {
    mockProposals = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }));
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        onOpenPalette={vi.fn()}
        onAskAgent={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    const badge = await screen.findByText("9+");
    expect(badge).toHaveTextContent("9+");
    expect(badge).toHaveAttribute("aria-hidden", "true");
  });

  it("renders an Ask agent button", async () => {
    mockProposals = [];
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        onOpenPalette={vi.fn()}
        onAskAgent={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    expect(
      await screen.findByRole("button", { name: "Ask agent" }),
    ).toBeInTheDocument();
  });

  it("calls onAskAgent when the Ask agent button is clicked", async () => {
    const onAskAgent = vi.fn();
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        onOpenPalette={vi.fn()}
        onAskAgent={onAskAgent}
      />,
      { path: "/w/test-ws/workboard" },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Ask agent" }));
    expect(onAskAgent).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenPalette when the command palette button is clicked", async () => {
    const onOpenPalette = vi.fn();
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        onOpenPalette={onOpenPalette}
        onAskAgent={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Open command palette" }),
    );
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("does not render a breadcrumb (removed as redundant, 2026-06-25)", async () => {
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        onOpenPalette={vi.fn()}
        onAskAgent={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    // Wait for the bar to mount, then lock in the intentional deviation.
    await screen.findByRole("button", { name: "Ask agent" });
    expect(
      screen.queryByRole("navigation", { name: "Breadcrumb" }),
    ).not.toBeInTheDocument();
  });
});
