import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test", orgId: "org_test" }),
}));

// Spy both adapter factories so we can prove the default (non-fixtures) path
// selects the network adapter and never builds the in-memory mock.
const { networkFactory, mockFactory } = vi.hoisted(() => ({
  networkFactory: vi.fn(() => ({ get: vi.fn() })),
  mockFactory: vi.fn(() => ({ get: vi.fn() })),
}));
vi.mock("./adapter", () => ({ createMemoryImpactAdapter: networkFactory }));
vi.mock("./mock", () => ({ createMockMemoryImpactAdapter: mockFactory }));

import {
  MemoryImpactProvider,
  useMemoryImpactContext,
} from "./MemoryImpactProvider";

describe("MemoryImpactProvider", () => {
  beforeEach(() => {
    networkFactory.mockClear();
    mockFactory.mockClear();
  });

  it("provides a network impact adapter to consumers inside the provider", () => {
    const { result } = renderHook(() => useMemoryImpactContext(), {
      wrapper: MemoryImpactProvider,
    });
    expect(result.current).not.toBeNull();
    expect(typeof result.current?.get).toBe("function");
  });

  it("selects the NETWORK adapter (not the mock) on the default path", () => {
    renderHook(() => useMemoryImpactContext(), { wrapper: MemoryImpactProvider });
    expect(networkFactory).toHaveBeenCalledTimes(1);
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it("returns null outside a provider (so callers fall back to the mock)", () => {
    const { result } = renderHook(() => useMemoryImpactContext());
    expect(result.current).toBeNull();
  });
});
