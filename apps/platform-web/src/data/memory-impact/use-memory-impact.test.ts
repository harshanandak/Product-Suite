import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MemoryImpactAdapter } from "./adapter";
import { createMemoryImpactFixture, createMockMemoryImpactAdapter } from "./mock";
import { useMemoryImpact } from "./use-memory-impact";

describe("useMemoryImpact", () => {
  it("loads the impact from the injected adapter", async () => {
    const adapter = createMockMemoryImpactAdapter(
      createMemoryImpactFixture({ verdict: "helps", savedEdits: 7 }),
    );
    const { result } = renderHook(() => useMemoryImpact({ adapter }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.impact?.verdict).toBe("helps");
    expect(result.current.impact?.savedEdits).toBe(7);
    expect(result.current.error).toBeNull();
  });

  it("passes the window through to the adapter", async () => {
    const adapter = createMockMemoryImpactAdapter();
    const spy = vi.spyOn(adapter, "get");
    renderHook(() => useMemoryImpact({ adapter, windowDays: 7 }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(7);
  });

  it("re-resolves when the injected adapter changes (not frozen on first render)", async () => {
    const first = createMockMemoryImpactAdapter(
      createMemoryImpactFixture({ verdict: "helps", savedEdits: 3 }),
    );
    const second = createMockMemoryImpactAdapter(
      createMemoryImpactFixture({ verdict: "hurts", savedEdits: -4 }),
    );
    const { result, rerender } = renderHook(
      ({ adapter }: { adapter: MemoryImpactAdapter }) => useMemoryImpact({ adapter }),
      { initialProps: { adapter: first } },
    );
    await waitFor(() => expect(result.current.impact?.savedEdits).toBe(3));

    // Swap the adapter (e.g. an org switch rebuilt it) — the hook must pick up the new source.
    rerender({ adapter: second });
    await waitFor(() => expect(result.current.impact?.verdict).toBe("hurts"));
    expect(result.current.impact?.savedEdits).toBe(-4);
  });

  it("surfaces a load error and leaves impact null", async () => {
    const failing: MemoryImpactAdapter = {
      get: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { result } = renderHook(() => useMemoryImpact({ adapter: failing }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.impact).toBeNull();
  });
});
