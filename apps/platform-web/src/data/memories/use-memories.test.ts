import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MemoriesAdapter } from "./adapter";
import { createMockMemoriesAdapter } from "./mock";
import { useMemories } from "./use-memories";

describe("useMemories", () => {
  it("loads the list from the injected adapter", async () => {
    const adapter = createMockMemoriesAdapter();
    const { result } = renderHook(() => useMemories({ adapter }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.memories.length).toBeGreaterThan(0);
    expect(result.current.error).toBeNull();
  });

  it("create() adds a memory and refetches the list on settle", async () => {
    const adapter = createMockMemoriesAdapter();
    const { result } = renderHook(() => useMemories({ adapter }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = result.current.memories.length;

    await act(async () => {
      await result.current.create({ kind: "fact", title: "Logged via hook" });
    });
    await waitFor(() =>
      expect(result.current.memories.length).toBe(before + 1),
    );
    expect(
      result.current.memories.some((m) => m.title === "Logged via hook"),
    ).toBe(true);
  });

  it("surfaces a load error and clears it on refetch", async () => {
    const failing: MemoriesAdapter = {
      list: vi.fn(async () => {
        throw new Error("boom");
      }),
      get: vi.fn(),
      create: vi.fn(),
      supersede: vi.fn(),
      retract: vi.fn(),
      defer: vi.fn(),
    };
    const { result } = renderHook(() => useMemories({ adapter: failing }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
  });

  it("passes filters through to the adapter", async () => {
    const adapter = createMockMemoriesAdapter();
    const spy = vi.spyOn(adapter, "list");
    renderHook(() => useMemories({ adapter, filters: { kind: "fact" } }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ kind: "fact" });
  });
});
