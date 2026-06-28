import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FacetOption } from "../filter-state";
import { FacetFilterMenu } from "./FacetFilterMenu";

/**
 * Radix DropdownMenu reaches for Pointer-Capture / scrollIntoView jsdom omits;
 * the searchable variant adds cmdk, which also needs ResizeObserver + scrollTo.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  if (typeof window.scrollTo !== "function") {
    window.scrollTo = () => {};
  }
});

/** Nine distinct options — clears the ~8 threshold that gates the search box. */
const LONG_OPTIONS: FacetOption[] = [
  { value: "ada", label: "Ada Lovelace" },
  { value: "alan", label: "Alan Turing" },
  { value: "grace", label: "Grace Hopper" },
  { value: "linus", label: "Linus Torvalds" },
  { value: "katherine", label: "Katherine Johnson" },
  { value: "margaret", label: "Margaret Hamilton" },
  { value: "barbara", label: "Barbara Liskov" },
  { value: "donald", label: "Donald Knuth" },
  { value: "edsger", label: "Edsger Dijkstra" },
];

afterAll(() => {
  vi.restoreAllMocks();
});

const OPTIONS: FacetOption[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

describe("FacetFilterMenu", () => {
  it("renders a trigger named for the facet", () => {
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set()}
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Filter by type" }),
    ).toBeInTheDocument();
  });

  it("surfaces the selection count in the accessible name and a badge", () => {
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set(["a"])}
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Filter by type (1)" }),
    ).toBeInTheDocument();
  });

  it("opens the menu and toggles an option through onToggle", async () => {
    const onToggle = vi.fn();
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set()}
        onToggle={onToggle}
      />,
    );
    // Radix opens cleanly via the keyboard path (a click sequence re-closes it).
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter by type" }), {
      key: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole(
        "menuitemcheckbox",
        { name: "Beta" },
        { timeout: 5000 },
      ),
    );
    expect(onToggle).toHaveBeenCalledWith("b");
  });

  it("omits the Select all / Clear header when onSetSelected is absent (#14)", async () => {
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set()}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter by type" }), {
      key: "ArrowDown",
    });
    // The checkbox items appear, but no bulk header row.
    await screen.findByRole("menuitemcheckbox", { name: "Alpha" });
    expect(
      screen.queryByRole("menuitem", { name: "Select all" }),
    ).not.toBeInTheDocument();
  });

  it("selects every option in one shot via the Select all header (#14)", async () => {
    const onSetSelected = vi.fn<(next: Set<string>) => void>();
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set<string>()}
        onToggle={vi.fn()}
        onSetSelected={onSetSelected}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter by type" }), {
      key: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Select all" }),
    );
    // A SINGLE call carrying the complete set (never N toggles).
    expect(onSetSelected).toHaveBeenCalledTimes(1);
    expect([...onSetSelected.mock.calls[0]![0]]).toEqual(["a", "b"]);
  });

  it("empties the facet in one shot via the Clear header (#14)", async () => {
    const onSetSelected = vi.fn<(next: Set<string>) => void>();
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set(["a", "b"])}
        onToggle={vi.fn()}
        onSetSelected={onSetSelected}
      />,
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Filter by type (2)" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Clear" }));
    expect(onSetSelected).toHaveBeenCalledTimes(1);
    expect(onSetSelected.mock.calls[0]![0].size).toBe(0);
  });

  it("keeps the plain checkbox menu (no search box) for short searchable lists (#8)", async () => {
    render(
      <FacetFilterMenu
        label="Owner"
        options={OPTIONS}
        selected={new Set()}
        onToggle={vi.fn()}
        searchable
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter by owner" }), {
      key: "ArrowDown",
    });
    // Two options stay checkbox items; no cmdk search input appears.
    await screen.findByRole("menuitemcheckbox", { name: "Alpha" });
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });

  it("renders a search box and filters the options as you type (#8)", async () => {
    render(
      <FacetFilterMenu
        label="Owner"
        options={LONG_OPTIONS}
        selected={new Set()}
        onToggle={vi.fn()}
        searchable
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter by owner" }), {
      key: "ArrowDown",
    });
    // Long list → a cmdk search box plus every option to start with.
    const search = await screen.findByPlaceholderText("Search owner");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();

    // Typing narrows the visible options to the matches.
    fireEvent.change(search, { target: { value: "grace" } });
    await waitFor(() => {
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
  });

  it("announces each option's selected state in the searchable list (#8)", async () => {
    render(
      <FacetFilterMenu
        label="Owner"
        options={LONG_OPTIONS}
        selected={new Set(["grace"])}
        onToggle={vi.fn()}
        searchable
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /filter by owner/i }), {
      key: "ArrowDown",
    });
    // cmdk items are role="option"; an sr-only cue voices the checked state the
    // (aria-hidden) check icon shows, so AT isn't left guessing.
    expect(
      await screen.findByRole("option", { name: "Grace Hopper selected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Ada Lovelace not selected" }),
    ).toBeInTheDocument();
  });

  it("renders a compact funnel trigger named 'Filter <Label>' for the column header", () => {
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set()}
        onToggle={vi.fn()}
        compact
      />,
    );
    // The compact trigger drops the toolbar's "Filter by type" wording for the
    // header-scoped "Filter Type" (no visible label text, just the funnel).
    expect(
      screen.getByRole("button", { name: "Filter Type" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Filter by type" }),
    ).not.toBeInTheDocument();
  });

  it("shows the active count in the compact trigger's accessible name", () => {
    render(
      <FacetFilterMenu
        label="Type"
        options={OPTIONS}
        selected={new Set(["a"])}
        onToggle={vi.fn()}
        compact
      />,
    );
    expect(
      screen.getByRole("button", { name: "Filter Type (1)" }),
    ).toBeInTheDocument();
  });

  it("toggles a filtered option through onToggle in the searchable list (#8)", async () => {
    const onToggle = vi.fn();
    render(
      <FacetFilterMenu
        label="Owner"
        options={LONG_OPTIONS}
        selected={new Set()}
        onToggle={onToggle}
        searchable
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter by owner" }), {
      key: "ArrowDown",
    });
    const search = await screen.findByPlaceholderText("Search owner");
    fireEvent.change(search, { target: { value: "grace" } });
    fireEvent.click(await screen.findByText("Grace Hopper"));
    expect(onToggle).toHaveBeenCalledWith("grace");
  });
});
