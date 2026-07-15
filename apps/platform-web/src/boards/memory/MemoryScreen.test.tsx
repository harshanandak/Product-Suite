import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// MemoryScreen only reads `useSearch` from the router; stub it (mirrors the
// InboxScreen test). `?new` drives the auto-open, defaulted to closed here.
let searchMock: { new?: boolean } = {};
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => searchMock,
}));

import { createMockMemoriesAdapter } from "@/data/memories";

import { MemoryScreen } from "./MemoryScreen";

describe("MemoryScreen", () => {
  beforeEach(() => {
    searchMock = {};
  });

  it("renders the Decision Log with source-grouped memories", async () => {
    render(<MemoryScreen adapter={createMockMemoriesAdapter()} />);
    expect(await screen.findByText("Decision Log")).toBeInTheDocument();
    // Fixtures include a meeting-sourced and a manual-sourced memory.
    expect(screen.getByText("From meetings")).toBeInTheDocument();
    expect(
      screen.getByText("Standardize on Kimi K2.5 for the blog writer"),
    ).toBeInTheDocument();
  });

  it("switches to the Topics view (resolved-to-current, grouped by topic)", async () => {
    render(<MemoryScreen adapter={createMockMemoriesAdapter()} />);
    await screen.findByText("Decision Log");
    fireEvent.click(screen.getByRole("button", { name: "Topics" }));
    // A fixture topic HEADING appears in the topic view ("models" also shows as
    // a tag chip on the item, so match the heading specifically).
    expect(
      await screen.findByRole("heading", { name: "models" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "meta-ads" })).toBeInTheDocument();
  });

  it("opens the Log a decision form from the header button", async () => {
    render(<MemoryScreen adapter={createMockMemoriesAdapter()} />);
    await screen.findByText("Decision Log");
    expect(screen.queryByLabelText("Title")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log a decision" }));
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("auto-opens the form when ?new is set", async () => {
    searchMock = { new: true };
    render(<MemoryScreen adapter={createMockMemoriesAdapter()} />);
    await screen.findByText("Decision Log");
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("shows an empty state when there are no memories", async () => {
    render(<MemoryScreen adapter={createMockMemoriesAdapter({ seed: [] })} />);
    expect(await screen.findByText("No memories yet")).toBeInTheDocument();
  });
});
