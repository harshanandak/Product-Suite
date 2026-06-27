import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderWithRouter } from "../test/harness";
import { TopBar } from "./TopBar";

vi.mock("./UserMenu", () => ({
  UserMenu: () => null,
}));

describe("TopBar", () => {
  it("renders an Ask agent button", async () => {
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
        onOpenPalette={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    expect(
      await screen.findByRole("button", { name: "Ask agent" }),
    ).toBeInTheDocument();
  });

  it("calls onOpenPalette when the command palette button is clicked", async () => {
    const onOpenPalette = vi.fn();
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
        onOpenPalette={onOpenPalette}
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
        pathname="/w/test-ws/workboard"
        onOpenPalette={vi.fn()}
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
