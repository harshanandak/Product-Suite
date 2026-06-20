import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockWorkItemRepository } from "./repository";
import type { WorkItemRepository } from "./repository";
import { useWorkItems } from "./use-work-items";

describe("useWorkItems", () => {
  it("loads rows with derived health + task counts and clears loading", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items.length).toBeGreaterThan(0);
    expect(result.current.projects.length).toBeGreaterThan(0);

    const row = result.current.items[0];
    expect(row).toHaveProperty("health");
    expect(row).toHaveProperty("taskCount");
    expect(row).toHaveProperty("completedTaskCount");
    expect(["on_track", "at_risk", "blocked"]).toContain(row.health);
  });

  it("optimistically updates a work item and reconciles with the repository", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const target = result.current.items[0];

    await act(async () => {
      await result.current.update(target.id, { phase: "done" });
    });

    const updated = result.current.items.find((item) => item.id === target.id);
    expect(updated?.phase).toBe("done");
  });

  it("rolls back the optimistic update when the repository rejects", async () => {
    const base = createMockWorkItemRepository();
    const failing: WorkItemRepository = {
      ...base,
      update: vi.fn().mockRejectedValue(new Error("write failed")),
    };

    const { result } = renderHook(() => useWorkItems({ repository: failing }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const target = result.current.items[0];
    const originalPhase = target.phase;
    const nextPhase = originalPhase === "done" ? "plan" : "done";

    await act(async () => {
      await expect(
        result.current.update(target.id, { phase: nextPhase }),
      ).rejects.toThrow("write failed");
    });

    const reverted = result.current.items.find((item) => item.id === target.id);
    expect(reverted?.phase).toBe(originalPhase);
  });

  it("surfaces a load error and recovers on refetch", async () => {
    const base = createMockWorkItemRepository();
    const listSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation(() => base.list());
    const flaky: WorkItemRepository = { ...base, list: listSpy };

    const { result } = renderHook(() => useWorkItems({ repository: flaky }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");

    act(() => {
      result.current.refetch();
    });

    // Wait on the load actually completing (items populated), not on `error`
    // clearing — the effect resets `error` synchronously at the top of refetch.
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    expect(result.current.error).toBeNull();
  });

  it("refetches when the realtime subscription fires", async () => {
    const base = createMockWorkItemRepository();
    let fire: (() => void) | undefined;
    const repository: WorkItemRepository = {
      ...base,
      subscribe: (onInvalidate) => {
        fire = onInvalidate;
        return () => {
          fire = undefined;
        };
      },
    };
    const listSpy = vi.spyOn(repository, "list");

    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callsBefore = listSpy.mock.calls.length;

    act(() => {
      fire?.();
    });

    await waitFor(() =>
      expect(listSpy.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
});
