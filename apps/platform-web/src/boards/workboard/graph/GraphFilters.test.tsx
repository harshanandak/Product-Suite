import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createOwnerFixtures } from "@/data/work-items";

import {
  defaultWorkboardFilterState,
  type WorkboardFilterState,
} from "../filter-state";
import { GraphFilters } from "./GraphFilters";

/** Radix DropdownMenu (the facet menus) reaches for Pointer-Capture jsdom omits. */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterAll(() => {
  vi.restoreAllMocks();
});

const DEPARTMENTS = ["Engineering", "Marketing"];

describe("GraphFilters", () => {
  it("renders search + the five facet menus", () => {
    render(
      <GraphFilters
        value={defaultWorkboardFilterState()}
        onChange={vi.fn()}
        owners={createOwnerFixtures()}
        departments={DEPARTMENTS}
      />,
    );

    // The cluster is a vertical toolbar (stacked filter list, not a button row).
    expect(
      screen.getByRole("toolbar", { name: "Graph filters" }),
    ).toHaveAttribute("aria-orientation", "vertical");

    expect(screen.getByLabelText("Search work items")).toBeInTheDocument();
    for (const facet of ["type", "owner", "department", "phase", "priority"]) {
      expect(
        screen.getByRole("button", {
          name: new RegExp(`filter by ${facet}`, "i"),
        }),
      ).toBeInTheDocument();
    }
  });

  it("emits a new state carrying the typed search", () => {
    const onChange = vi.fn();
    render(
      <GraphFilters
        value={defaultWorkboardFilterState()}
        onChange={onChange}
        owners={createOwnerFixtures()}
        departments={DEPARTMENTS}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search work items"), {
      target: { value: "auth" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "auth" }),
    );
  });

  it("shows Clear only when active and resets search + facets on click", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <GraphFilters
        value={defaultWorkboardFilterState()}
        onChange={onChange}
        owners={createOwnerFixtures()}
        departments={DEPARTMENTS}
      />,
    );
    // Inactive → no Clear button.
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();

    const active: WorkboardFilterState = {
      ...defaultWorkboardFilterState(),
      search: "auth",
    };
    rerender(
      <GraphFilters
        value={active}
        onChange={onChange}
        owners={createOwnerFixtures()}
        departments={DEPARTMENTS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "" }),
    );
  });
});
