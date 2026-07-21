import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FILTER_STORAGE_KEY,
  SAVED_VIEWS_KEY,
  parsePersistedView,
  parseSavedViews,
  serializeSavedViews,
  type SavedView,
} from "../filter-state";
import { WorkboardViewsScreen } from "./WorkboardViewsScreen";

// Mock the router so useNavigate/useParams resolve without a RouterProvider, and
// capture the navigate call. The real navigate returns a Promise the screen
// `.catch`es, so the mock must resolve to keep that chain valid.
const navMock = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve()) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navMock.fn,
  useParams: () => ({ workspace: "acme" }),
}));

const VIEWS: SavedView[] = [
  { id: "v1", name: "Execute lane", config: { search: "auth", layout: "board" } },
  { id: "v2", name: "All done", config: { groupBy: "priority" } },
];

beforeEach(() => {
  window.localStorage.clear();
  navMock.fn.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("WorkboardViewsScreen", () => {
  it("shows an empty state when no views are saved", () => {
    render(<WorkboardViewsScreen />);
    expect(screen.getByText("No saved views yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Saved views" }),
    ).not.toBeInTheDocument();
  });

  it("lists every saved view from localStorage", () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeSavedViews(VIEWS));
    render(<WorkboardViewsScreen />);
    expect(
      screen.getByRole("button", { name: "Apply view Execute lane" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply view All done" }),
    ).toBeInTheDocument();
  });

  it("applies a view: writes its config to the workboard key and navigates there", () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeSavedViews(VIEWS));
    render(<WorkboardViewsScreen />);

    fireEvent.click(
      screen.getByRole("button", { name: "Apply view Execute lane" }),
    );

    // The chosen view's config lands in the workboard's last-applied key so the
    // workboard restores it on mount (search + layout round-trip).
    const restored = parsePersistedView(
      window.localStorage.getItem(FILTER_STORAGE_KEY),
    );
    expect(restored?.search).toBe("auth");
    expect(restored?.layout).toBe("board");

    // …and navigation lands on the work-items surface.
    expect(navMock.fn).toHaveBeenCalledWith({
      to: "/w/$workspace/workboard",
      params: { workspace: "acme" },
    });
  });

  it("deletes a view, removing it from storage", () => {
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeSavedViews(VIEWS));
    render(<WorkboardViewsScreen />);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete view Execute lane" }),
    );

    // Removed from the rendered list…
    expect(
      screen.queryByRole("button", { name: "Apply view Execute lane" }),
    ).not.toBeInTheDocument();
    // …and from storage (only "All done" remains).
    const remaining = parseSavedViews(
      window.localStorage.getItem(SAVED_VIEWS_KEY),
    );
    expect(remaining.map((view) => view.id)).toEqual(["v2"]);
  });

  it("navigates to the workboard from the empty-state CTA", () => {
    render(<WorkboardViewsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Go to workboard" }));
    expect(navMock.fn).toHaveBeenCalledWith({
      to: "/w/$workspace/workboard",
      params: { workspace: "acme" },
    });
  });
});
