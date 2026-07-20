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

    const badge = await screen.findByLabelText("3 pending proposals");
    expect(badge).toHaveTextContent("3");
    // The button itself stays labeled "Ask agent" (badge is a sibling, not a child).
    expect(
      screen.getByRole("button", { name: "Ask agent" }),
    ).toBeInTheDocument();
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

    const badge = await screen.findByLabelText("12 pending proposals");
    expect(badge).toHaveTextContent("9+");
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
