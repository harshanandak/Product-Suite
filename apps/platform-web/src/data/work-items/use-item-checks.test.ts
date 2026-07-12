import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockWorkItemRepository } from "./repository";
import type { WorkItemRepository } from "./repository";
import type { Check } from "./types";
import { useItemChecks } from "./use-item-checks";

describe("useItemChecks", () => {
  it("loads only the given item's checks and clears loading", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemChecks({ repository, workItemId: "wi_auth" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.checks.length).toBeGreaterThan(0);
    expect(
      result.current.checks.every((check) => check.work_item_id === "wi_auth"),
    ).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("short-circuits to an empty, non-loading result when no item is open", async () => {
    const repository = createMockWorkItemRepository();
    const getChecks = vi.spyOn(repository, "getChecks");
    const { result } = renderHook(() =>
      useItemChecks({ repository, workItemId: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.checks).toEqual([]);
    // Never fetch when there is no open item (the whole point of PR3).
    expect(getChecks).not.toHaveBeenCalled();
  });

  it("re-loads when the workItemId changes", async () => {
    const repository = createMockWorkItemRepository();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useItemChecks({ repository, workItemId: id }),
      { initialProps: { id: "wi_auth" } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(
      result.current.checks.every((check) => check.work_item_id === "wi_auth"),
    ).toBe(true);

    rerender({ id: "wi_realtime" });

    await waitFor(() =>
      expect(
        result.current.checks.length > 0 &&
          result.current.checks.every(
            (check) => check.work_item_id === "wi_realtime",
          ),
      ).toBe(true),
    );
  });

  it("advances a check around the status triad optimistically", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemChecks({ repository, workItemId: "wi_realtime" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // t_rt_2 seeds as "todo"; one toggle advances it to "in_progress".
    await act(async () => {
      await result.current.toggleStatus("t_rt_2");
    });

    const toggled = result.current.checks.find((check) => check.id === "t_rt_2");
    expect(toggled?.status).toBe("in_progress");
    expect(result.current.pendingCheckIds.has("t_rt_2")).toBe(false);
  });

  it("rolls back the optimistic toggle when the repository rejects", async () => {
    const base = createMockWorkItemRepository();
    const failing: WorkItemRepository = {
      ...base,
      toggleStatus: vi.fn().mockRejectedValue(new Error("toggle failed")),
    };
    const { result } = renderHook(() =>
      useItemChecks({ repository: failing, workItemId: "wi_realtime" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.toggleStatus("t_rt_2")).rejects.toThrow(
        "toggle failed",
      );
    });

    // Status is restored and the pending cue is cleared.
    const rolledBack = result.current.checks.find(
      (check) => check.id === "t_rt_2",
    );
    expect(rolledBack?.status).toBe("todo");
    expect(result.current.pendingCheckIds.has("t_rt_2")).toBe(false);
  });

  it("creates a check under the open item and appends it", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemChecks({ repository, workItemId: "wi_auth" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const countBefore = result.current.checks.length;

    let created: { id: string; work_item_id: string } | undefined;
    await act(async () => {
      created = await result.current.createCheck({ title: "New check" });
    });

    expect(result.current.checks.length).toBe(countBefore + 1);
    expect(created?.work_item_id).toBe("wi_auth");
    expect(
      result.current.checks.some((check) => check.title === "New check"),
    ).toBe(true);
  });

  it("does NOT append a created check after the open item changed mid-await (stale guard)", async () => {
    const base = createMockWorkItemRepository();
    // Gate `createCheck` so the create stays pending while we switch items.
    let resolveCreate!: (check: Check) => void;
    const createGate = new Promise<Check>((resolve) => {
      resolveCreate = resolve;
    });
    const repository: WorkItemRepository = {
      ...base,
      createCheck: vi.fn(() => createGate),
    };

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useItemChecks({ repository, workItemId: id }),
      { initialProps: { id: "wi_auth" } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start a create under wi_auth; the repo's createCheck is gated (still pending).
    const createPromise = result.current.createCheck({ title: "Stale check" });

    // The open item changes to wi_realtime BEFORE the create resolves.
    rerender({ id: "wi_realtime" });
    await waitFor(() =>
      expect(
        result.current.checks.length > 0 &&
          result.current.checks.every(
            (check) => check.work_item_id === "wi_realtime",
          ),
      ).toBe(true),
    );

    // The create now resolves — but the check belongs to the OLD item (wi_auth).
    const staleCheck: Check = {
      id: "check_stale",
      work_item_id: "wi_auth",
      title: "Stale check",
      status: "todo",
      due_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await act(async () => {
      resolveCreate(staleCheck);
      await createPromise;
    });

    // It must NOT leak into wi_realtime's list; the caller still gets the record.
    expect(result.current.checks.some((check) => check.id === "check_stale")).toBe(
      false,
    );
    expect(
      result.current.checks.every((check) => check.work_item_id === "wi_realtime"),
    ).toBe(true);
  });

  it("rejects createCheck when no item is open", async () => {
    const repository = createMockWorkItemRepository();
    const { result } = renderHook(() =>
      useItemChecks({ repository, workItemId: null }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.createCheck({ title: "x" })).rejects.toThrow(
        /without an open work item/i,
      );
    });
  });
});
