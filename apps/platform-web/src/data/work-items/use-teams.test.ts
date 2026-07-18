import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createMockWorkItemRepository } from "./repository";
import type { WorkItemRepository } from "./repository";
import { useTeams } from "./use-teams";

describe("useTeams", () => {
  it("derives deduped teams sorted by name from the repository", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useTeams({ repository }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The fixtures span Engineering / Marketing / Sourcing — deduped by team_id
    // (many items per team) and sorted by display name (the department field).
    expect(result.current.teams).toEqual([
      { id: "team_engineering", name: "Engineering" },
      { id: "team_marketing", name: "Marketing" },
      { id: "team_sourcing", name: "Sourcing" },
    ]);
  });

  it("returns an empty list when the repository has no work items", async () => {
    const base = createMockWorkItemRepository();
    const empty: WorkItemRepository = {
      ...base,
      list: () => Promise.resolve([]),
    };
    const { result } = renderHook(() => useTeams({ repository: empty }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.teams).toEqual([]);
  });
});
