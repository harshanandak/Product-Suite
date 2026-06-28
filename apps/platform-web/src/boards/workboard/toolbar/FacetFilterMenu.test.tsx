import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { FacetOption } from "../filter-state";
import { FacetFilterMenu } from "./FacetFilterMenu";

/** Radix DropdownMenu reaches for Pointer-Capture / scrollIntoView jsdom omits. */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

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
});
