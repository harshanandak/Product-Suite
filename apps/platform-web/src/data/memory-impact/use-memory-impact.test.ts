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
