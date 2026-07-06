import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockWorkItemRepository } from "./repository";
import type { WorkItemRepository } from "./repository";
import { useItemTasks } from "./use-item-tasks";

describe("useItemTasks", () => {
  it("loads only the given item's tasks and clears loading", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemTasks({ repository, workItemId: "wi_auth" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.tasks.length).toBeGreaterThan(0);
    expect(
      result.current.tasks.every((task) => task.work_item_id === "wi_auth"),
    ).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("short-circuits to an empty, non-loading result when no item is open", async () => {
    const repository = createMockWorkItemRepository();
    const getTasks = vi.spyOn(repository, "getTasks");
    const { result } = renderHook(() =>
      useItemTasks({ repository, workItemId: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.tasks).toEqual([]);
    // Never fetch when there is no open item (the whole point of PR3).
    expect(getTasks).not.toHaveBeenCalled();
  });

  it("re-loads when the workItemId changes", async () => {
    const repository = createMockWorkItemRepository();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useItemTasks({ repository, workItemId: id }),
      { initialProps: { id: "wi_auth" } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(
      result.current.tasks.every((task) => task.work_item_id === "wi_auth"),
    ).toBe(true);

    rerender({ id: "wi_realtime" });

    await waitFor(() =>
      expect(
        result.current.tasks.length > 0 &&
          result.current.tasks.every(
            (task) => task.work_item_id === "wi_realtime",
          ),
      ).toBe(true),
    );
  });

  it("advances a task around the status triad optimistically", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemTasks({ repository, workItemId: "wi_realtime" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // t_rt_2 seeds as "todo"; one toggle advances it to "in_progress".
    await act(async () => {
      await result.current.toggleStatus("t_rt_2");
    });

    const toggled = result.current.tasks.find((task) => task.id === "t_rt_2");
    expect(toggled?.status).toBe("in_progress");
    expect(result.current.pendingTaskIds.has("t_rt_2")).toBe(false);
  });

  it("rolls back the optimistic toggle when the repository rejects", async () => {
    const base = createMockWorkItemRepository();
    const failing: WorkItemRepository = {
      ...base,
      toggleStatus: vi.fn().mockRejectedValue(new Error("toggle failed")),
    };
    const { result } = renderHook(() =>
      useItemTasks({ repository: failing, workItemId: "wi_realtime" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.toggleStatus("t_rt_2")).rejects.toThrow(
        "toggle failed",
      );
    });

    // Status is restored and the pending cue is cleared.
    const rolledBack = result.current.tasks.find(
      (task) => task.id === "t_rt_2",
    );
    expect(rolledBack?.status).toBe("todo");
    expect(result.current.pendingTaskIds.has("t_rt_2")).toBe(false);
  });

  it("creates a task under the open item and appends it", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemTasks({ repository, workItemId: "wi_auth" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const countBefore = result.current.tasks.length;

    let created: { id: string; work_item_id: string } | undefined;
    await act(async () => {
      created = await result.current.createTask({ title: "New task" });
    });

    expect(result.current.tasks.length).toBe(countBefore + 1);
    expect(created?.work_item_id).toBe("wi_auth");
    expect(
      result.current.tasks.some((task) => task.title === "New task"),
    ).toBe(true);
  });

  it("rejects createTask when no item is open", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemTasks({ repository, workItemId: null }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.createTask({ title: "x" })).rejects.toThrow(
        /without an open work item/i,
      );
    });
  });
});
