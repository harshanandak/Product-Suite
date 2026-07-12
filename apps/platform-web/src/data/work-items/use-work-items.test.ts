import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockWorkItemRepository } from "./repository";
import type { WorkItemRepository } from "./repository";
import type { WorkItem } from "./types";
import { useWorkItems } from "./use-work-items";

describe("useWorkItems", () => {
  it("loads rows with derived health + check counts and clears loading", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items.length).toBeGreaterThan(0);
    expect(result.current.projects.length).toBeGreaterThan(0);
    expect(result.current.owners.length).toBeGreaterThan(0);

    const row = result.current.items[0];
    expect(row).toHaveProperty("health");
    expect(row).toHaveProperty("checkCount");
    expect(row).toHaveProperty("completedCheckCount");
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

  it("creates a work item and optimistically prepends it", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const countBefore = result.current.items.length;

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.create({ title: "Brand new item" });
    });

    expect(result.current.items.length).toBe(countBefore + 1);
    expect(result.current.items[0].id).toBe(created?.id);
    expect(result.current.items[0].title).toBe("Brand new item");
    // The created row carries derived view-model fields.
    expect(result.current.items[0]).toHaveProperty("health");
    expect(result.current.items[0].checkCount).toBe(0);
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

  it("exposes the saving item id via pendingIds while an update is in flight, then clears it on success", async () => {
    const base = createMockWorkItemRepository();
    let resolveUpdate: ((item: WorkItem) => void) | undefined;
    const deferred = new Promise<WorkItem>((resolve) => {
      resolveUpdate = resolve;
    });
    const repository: WorkItemRepository = {
      ...base,
      update: vi.fn().mockReturnValue(deferred),
    };

    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const target = result.current.items[0];
    expect(result.current.pendingIds.has(target.id)).toBe(false);

    let updatePromise!: Promise<WorkItem>;
    act(() => {
      updatePromise = result.current.update(target.id, { phase: "done" });
    });

    // Mid-save: the affected id is exposed as pending.
    expect(result.current.pendingIds.has(target.id)).toBe(true);

    await act(async () => {
      resolveUpdate?.({ ...target, phase: "done" });
      await updatePromise;
    });

    // Settled: the pending cue is cleared.
    expect(result.current.pendingIds.has(target.id)).toBe(false);
    // Optimistic semantics are unchanged — the saved value lands.
    expect(
      result.current.items.find((item) => item.id === target.id)?.phase,
    ).toBe("done");
  });

  it("clears the pending id after a rejected (rolled-back) update", async () => {
    const base = createMockWorkItemRepository();
    const failing: WorkItemRepository = {
      ...base,
      update: vi.fn().mockRejectedValue(new Error("write failed")),
    };

    const { result } = renderHook(() => useWorkItems({ repository: failing }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const target = result.current.items[0];

    await act(async () => {
      await expect(
        result.current.update(target.id, { phase: "done" }),
      ).rejects.toThrow("write failed");
    });

    // Rollback path also clears the pending cue (no stuck spinners).
    expect(result.current.pendingIds.has(target.id)).toBe(false);
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

  it("surfaces dependency edges on load", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.dependencies.length).toBeGreaterThan(0);
  });

  it("appends a dependency once the repository confirms it (pessimistic)", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const countBefore = result.current.dependencies.length;
    await act(async () => {
      await result.current.addDependency({
        source_item_id: "wi_tabletoken",
        target_item_id: "wi_adspend",
      });
    });

    expect(result.current.dependencies.length).toBe(countBefore + 1);
    expect(
      result.current.dependencies.some(
        (d) =>
          d.source_item_id === "wi_tabletoken" &&
          d.target_item_id === "wi_adspend",
      ),
    ).toBe(true);
  });

  it("propagates a rejected addDependency without adding an edge", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const countBefore = result.current.dependencies.length;
    await act(async () => {
      await expect(
        // wi_auth → wi_realtime already exists → duplicate, rejected.
        result.current.addDependency({
          source_item_id: "wi_auth",
          target_item_id: "wi_realtime",
        }),
      ).rejects.toThrow(/already exists/);
    });

    expect(result.current.dependencies.length).toBe(countBefore);
  });

  it("optimistically removes a dependency", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() => useWorkItems({ repository }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const target = result.current.dependencies[0];
    await act(async () => {
      await result.current.removeDependency(target.id);
    });

    expect(
      result.current.dependencies.some((d) => d.id === target.id),
    ).toBe(false);
  });

  it("rolls back an optimistic removal when the repository rejects", async () => {
    const base = createMockWorkItemRepository();
    const failing: WorkItemRepository = {
      ...base,
      removeDependency: vi.fn().mockRejectedValue(new Error("remove failed")),
    };
    const { result } = renderHook(() => useWorkItems({ repository: failing }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const target = result.current.dependencies[0];
    await act(async () => {
      await expect(result.current.removeDependency(target.id)).rejects.toThrow(
        "remove failed",
      );
    });

    // The edge is restored after the failed removal.
    expect(
      result.current.dependencies.some((d) => d.id === target.id),
    ).toBe(true);
  });
});
