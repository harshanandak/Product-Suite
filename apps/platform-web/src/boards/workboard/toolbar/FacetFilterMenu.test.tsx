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
});
