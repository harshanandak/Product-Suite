import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ProjectWithCounts, WorkItem } from "../../data/work-items/types";
import {
  createMockWorkItemRepository,
  type WorkItemRepository,
} from "../../data/work-items/repository";

import { ProjectsScreen } from "./ProjectsScreen";

/**
 * `totalCount`/`doneCount` default to 0 — most tests here care about status
 * grouping, health, or expansion, not progress, so a test only needs to set
 * them when it is asserting the progress column.
 */
function project(over: Partial<ProjectWithCounts> = {}): ProjectWithCounts {
  return {
    id: "p1",
    name: "Core product",
    kind: "general",
    status: "in_progress",
    lead_id: null,
    target_date: "2026-12-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    totalCount: 0,
    doneCount: 0,
    ...over,
  } as ProjectWithCounts;
}

/**
 * A real mock repository with the project/item sets replaced, so the screen sees
 * deterministic data while every other repository method still behaves.
 */
function repositoryWith(projects: ProjectWithCounts[], items: Partial<WorkItem>[]): WorkItemRepository {
  const base = createMockWorkItemRepository();
  const rows = items.map(
    (over, index) =>
      ({
        id: `w${index}`,
        project_id: "p1",
        phase: "execute",
        title: `Item ${index}`,
        tags: [],
        due_date: null,
        assignee_id: null,
        ...over,
      }) as WorkItem,
  );
  return {
    ...base,
    listProjects: () => Promise.resolve(projects),
    list: () => Promise.resolve(rows),
    listChecks: () => Promise.resolve([]),
  };
}

describe("ProjectsScreen", () => {
  test("groups projects under their status heading", async () => {
    render(
      <ProjectsScreen
        repository={repositoryWith(
          [
            project({ id: "p1", name: "Core product", status: "in_progress" }),
            project({ id: "p2", name: "Platform hardening", status: "backlog" }),
          ],
          [],
        )}
      />,
    );

    expect(await screen.findByText("Core product")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Platform hardening")).toBeInTheDocument();
  });

  test("shows a project's progress as done-over-total WORK ITEMS, from the server-computed counts", async () => {
    render(
      <ProjectsScreen
        repository={repositoryWith(
          [project({ totalCount: 3, doneCount: 1 })],
          [{ phase: "done" }, { phase: "execute" }, { phase: "plan" }],
        )}
      />,
    );

    expect(await screen.findByText("Core product")).toBeInTheDocument();
    expect(screen.getByTestId("project-progress-p1")).toHaveTextContent("1/3");
  });

  test("a project with no items reports no health rather than a flattering 'On track'", async () => {
    render(<ProjectsScreen repository={repositoryWith([project()], [])} />);

    expect(await screen.findByText("Core product")).toBeInTheDocument();
    expect(screen.getByTestId("project-health-p1")).toHaveTextContent("—");
    expect(screen.queryByText("On track")).not.toBeInTheDocument();
  });

  test("health reports the worst member health", async () => {
    render(
      <ProjectsScreen
        repository={repositoryWith(
          [project()],
          [{ due_date: "2020-01-01T00:00:00.000Z" }, { phase: "done" }],
        )}
      />,
    );

    // The overdue item derives to a non-on_track health, which the project must
    // surface rather than averaging away.
    expect(await screen.findByText("Core product")).toBeInTheDocument();
    expect(screen.getByTestId("project-health-p1")).not.toHaveTextContent("—");
  });

  test("a project's work items are hidden until it is expanded", async () => {
    render(
      <ProjectsScreen
        repository={repositoryWith([project()], [{ title: "Ship the write path" }])}
      />,
    );

    expect(await screen.findByText("Core product")).toBeInTheDocument();
    expect(screen.queryByText("Ship the write path")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand core product/i }));

    expect(await screen.findByText("Ship the write path")).toBeInTheDocument();
  });

  test("opening an item reports the item id to the caller", async () => {
    const onOpenItem = vi.fn();
    render(
      <ProjectsScreen
        repository={repositoryWith([project()], [{ id: "w0", title: "Ship the write path" }])}
        onOpenItem={onOpenItem}
      />,
    );

    expect(await screen.findByText("Core product")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand core product/i }));
    fireEvent.click(await screen.findByText("Ship the write path"));

    expect(onOpenItem).toHaveBeenCalledWith("w0");
  });

  test("renders one consistent target format", async () => {
    render(
      <ProjectsScreen
        repository={repositoryWith(
          [project({ target_date: "2026-12-01T00:00:00.000Z" })],
          [],
        )}
      />,
    );

    expect(await screen.findByText("Dec 2026")).toBeInTheDocument();
  });

  test("surfaces an empty state when there are no projects at all", async () => {
    render(<ProjectsScreen repository={repositoryWith([], [])} />);

    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    });
  });
});
