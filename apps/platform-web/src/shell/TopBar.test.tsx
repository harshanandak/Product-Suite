import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderWithRouter } from "../test/harness";
import { TopBar } from "./TopBar";

vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => null,
}));

describe("TopBar", () => {
  it("renders the board breadcrumb and screen title", async () => {
    renderWithRouter(
      <TopBar
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
        onOpenPalette={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    expect(
      await screen.findByRole("link", { name: "Workboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Work items")).toBeInTheDocument();
  });

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
});
