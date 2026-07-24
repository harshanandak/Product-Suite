import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ workspace: "acme" }),
}));

// The screen itself is covered by ProjectsScreen.test.tsx; here it is reduced to
// a trigger so this test isolates the ONE thing this file owns — turning an
// opened work item into a navigation.
vi.mock("./ProjectsScreen", () => ({
  ProjectsScreen: ({
    onOpenItem,
    onOpenProject,
  }: {
    onOpenItem?: (id: string) => void
    onOpenProject?: (id: string) => void
  }) => (
    <>
      <button type="button" onClick={() => onOpenItem?.("w-42")}>
        open item
      </button>
      <button type="button" onClick={() => onOpenProject?.("p-7")}>
        open project
      </button>
    </>
  ),
}));

import { ProjectsRoute } from "./ProjectsRoute";

describe("ProjectsRoute", () => {
  test("opening a work item navigates to that item's existing detail route", () => {
    render(<ProjectsRoute />);

    fireEvent.click(screen.getByRole("button", { name: "open item" }));

    // Reuses the work-item detail route rather than introducing a second,
    // parallel detail page owned by the projects surface.
    expect(navigate).toHaveBeenCalledWith({
      to: "/w/$workspace/workboard/item/$itemId",
      params: { workspace: "acme", itemId: "w-42" },
    });
  });

  test("carries the workspace from the route params, not a hardcoded value", () => {
    render(<ProjectsRoute />);
    fireEvent.click(screen.getByRole("button", { name: "open item" }));

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ workspace: "acme" }),
      }),
    );
  });
});

describe("ProjectsRoute — opening a whole project", () => {
  test("sends the reader to the work-items surface SCOPED to that project", () => {
    // Not a second detail page on the Projects board: the items surface already
    // exists, so a project's full list is that surface with a scope applied.
    render(<ProjectsRoute />);

    fireEvent.click(screen.getByRole("button", { name: "open project" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/w/$workspace/workboard",
      params: { workspace: "acme" },
      search: { project: "p-7" },
    });
  });
});
