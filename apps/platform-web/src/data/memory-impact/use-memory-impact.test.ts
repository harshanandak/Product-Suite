import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/fixtures-mode", () => ({ USE_FIXTURES: true }));

import { ServerStateProvider } from "@/data/server-state";

import type { MemoryImpactAdapter } from "./adapter";
import { createMemoryImpactFixture, createMockMemoryImpactAdapter } from "./mock";
import type { MemoryImpact } from "./types";
import { useMemoryImpact } from "./use-memory-impact";

describe("useMemoryImpact", () => {
  it("loads the impact from the injected adapter", async () => {
    const adapter = createMockMemoryImpactAdapter(
      createMemoryImpactFixture({ verdict: "helps", savedEdits: 7 }),
    );
    const { result } = renderHook(() => useMemoryImpact({ adapter }), {
      wrapper: ServerStateProvider,
    });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.impact?.verdict).toBe("helps");
    expect(result.current.impact?.savedEdits).toBe(7);
    expect(result.current.error).toBeNull();
  });

  it("passes the window through to the adapter", async () => {
    const adapter = createMockMemoryImpactAdapter();
    const spy = vi.spyOn(adapter, "get");
    renderHook(() => useMemoryImpact({ adapter, windowDays: 7 }), {
      wrapper: ServerStateProvider,
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(7, expect.any(AbortSignal));
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
      {
        initialProps: { adapter: first },
        wrapper: ServerStateProvider,
      },
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
    const { result } = renderHook(() => useMemoryImpact({ adapter: failing }), {
      wrapper: ServerStateProvider,
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.impact).toBeNull();
  });

  it("deduplicates concurrent consumers in the same authorization scope", async () => {
    const adapter = createMockMemoryImpactAdapter();
    const spy = vi.spyOn(adapter, "get");
    const { result } = renderHook(
      () => [useMemoryImpact({ adapter }), useMemoryImpact({ adapter })] as const,
      { wrapper: ServerStateProvider },
    );

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[1].loading).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("passes Query cancellation to the adapter when the final observer unmounts", async () => {
    let observedSignal: AbortSignal | undefined;
    const adapter: MemoryImpactAdapter = {
      get: vi.fn((_windowDays, signal) => {
        observedSignal = signal;
        return new Promise<MemoryImpact>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        });
      }),
    };
    const { unmount } = renderHook(() => useMemoryImpact({ adapter }), {
      wrapper: ServerStateProvider,
    });
    await waitFor(() => expect(observedSignal).toBeDefined());

    unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it.each([
    ["HTTP 401", Object.assign(new Error("Unauthorized"), { status: 401 })],
    ["abort", new DOMException("Aborted", "AbortError")],
  ])("does not retry %s failures", async (_case, failure) => {
    const adapter: MemoryImpactAdapter = {
      get: vi.fn(async () => {
        throw failure;
      }),
    };
    const { result } = renderHook(() => useMemoryImpact({ adapter }), {
      wrapper: ServerStateProvider,
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(adapter.get).toHaveBeenCalledTimes(1);
  });

  it("retries one transient network failure and then succeeds", async () => {
    const adapter: MemoryImpactAdapter = {
      get: vi
        .fn<MemoryImpactAdapter["get"]>()
        .mockRejectedValueOnce(new TypeError("network down"))
        .mockResolvedValueOnce(
          createMemoryImpactFixture({ verdict: "helps", savedEdits: 5 }),
        ),
    };
    const { result } = renderHook(() => useMemoryImpact({ adapter }), {
      wrapper: ServerStateProvider,
    });

    await waitFor(() => expect(result.current.impact?.savedEdits).toBe(5), {
      timeout: 3_000,
    });
    expect(adapter.get).toHaveBeenCalledTimes(2);
  });
});
