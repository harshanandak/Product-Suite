import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  orgId: "org_1" as string | null,
  userId: "user_1" as string | null,
}));

vi.mock("@/fixtures-mode", () => ({ USE_FIXTURES: false }));
vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    getToken: async () => "secret-token",
    orgId: authState.orgId,
    userId: authState.userId,
  }),
}));

import type { MemoryImpactAdapter } from "@/data/memory-impact/adapter";
import { createMemoryImpactFixture } from "@/data/memory-impact/mock";
import type { MemoryImpact } from "@/data/memory-impact/types";
import { useMemoryImpact } from "@/data/memory-impact/use-memory-impact";

import { ServerStateProvider, useServerState } from "./ServerStateProvider";

interface PendingRead {
  resolve: (value: MemoryImpact) => void;
  signal: AbortSignal | undefined;
}

function createControlledAdapter(): {
  adapter: MemoryImpactAdapter;
  reads: PendingRead[];
} {
  const reads: PendingRead[] = [];
  return {
    adapter: {
      get: vi.fn((_windowDays, signal) =>
        new Promise<MemoryImpact>((resolve) => {
          reads.push({ resolve, signal });
        }),
      ),
    },
    reads,
  };
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <ServerStateProvider>{children}</ServerStateProvider>;
}

function useScopedImpact(adapter: MemoryImpactAdapter) {
  const result = useMemoryImpact({ adapter });
  const { scope } = useServerState();
  return { ...result, scopeKey: scope.key };
}

describe("authorization scope switching", () => {
  beforeEach(() => {
    authState.orgId = "org_1";
    authState.userId = "user_1";
  });

  it.each([
    ["organization", () => (authState.orgId = "org_2")],
    ["principal", () => (authState.userId = "user_2")],
  ])("aborts the old in-flight read on %s change", async (_case, changeScope) => {
    const { adapter, reads } = createControlledAdapter();
    const { rerender, result } = renderHook(() => useScopedImpact(adapter), {
      wrapper,
    });
    await waitFor(() => expect(reads).toHaveLength(1));
    const oldRead = reads[0]!;

    act(() => {
      changeScope();
      rerender();
    });

    await waitFor(() => expect(reads).toHaveLength(2));
    expect(oldRead.signal?.aborted).toBe(true);
    expect(result.current.loading).toBe(true);
    expect(result.current.impact).toBeNull();
  });

  it.each([
    ["organization", () => (authState.orgId = "org_2")],
    ["principal", () => (authState.userId = "user_2")],
  ])(
    "never renders the old cached/result data before the new %s scope fetch",
    async (_case, changeScope) => {
      const { adapter, reads } = createControlledAdapter();
      const { rerender, result } = renderHook(() => useScopedImpact(adapter), {
        wrapper,
      });
      await waitFor(() => expect(reads).toHaveLength(1));
      act(() =>
        reads[0]!.resolve(
          createMemoryImpactFixture({ verdict: "helps", savedEdits: 11 }),
        ),
      );
      await waitFor(() => expect(result.current.impact?.savedEdits).toBe(11));

      act(() => {
        changeScope();
        rerender();
      });

      expect(result.current.loading).toBe(true);
      expect(result.current.impact).toBeNull();
      await waitFor(() => expect(reads).toHaveLength(2));

      act(() =>
        reads[1]!.resolve(
          createMemoryImpactFixture({ verdict: "hurts", savedEdits: -2 }),
        ),
      );
      await waitFor(() => expect(result.current.impact?.savedEdits).toBe(-2));
    },
  );
});
