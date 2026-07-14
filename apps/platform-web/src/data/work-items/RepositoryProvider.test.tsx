import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test" }),
}));

// Spy both adapter factories so we can prove WHICH one the default (non-fixtures)
// path selects. USE_FIXTURES is false in the test env, so the network path must
// win and the in-memory fixture mock must never be built.
const { networkFactory, mockFactory } = vi.hoisted(() => ({
  networkFactory: vi.fn(() => ({ list: vi.fn(), create: vi.fn() })),
  mockFactory: vi.fn(() => ({ list: vi.fn(), create: vi.fn() })),
}));
vi.mock("./network-repository", () => ({
  createNetworkWorkItemRepository: networkFactory,
}));
vi.mock("./repository", () => ({
  createMockWorkItemRepository: mockFactory,
}));

import { RepositoryProvider, useRepositoryContext } from "./RepositoryProvider";

describe("RepositoryProvider", () => {
  beforeEach(() => {
    networkFactory.mockClear();
    mockFactory.mockClear();
  });

  it("provides a network repository to consumers inside the provider", () => {
    const { result } = renderHook(() => useRepositoryContext(), {
      wrapper: RepositoryProvider,
    });
    expect(result.current).not.toBeNull();
    // The provided value satisfies the WorkItemRepository seam.
    expect(typeof result.current?.list).toBe("function");
    expect(typeof result.current?.create).toBe("function");
  });

  it("selects the NETWORK repository (not the fixture mock) on the default path", () => {
    renderHook(() => useRepositoryContext(), { wrapper: RepositoryProvider });
    // Default path: network adapter built, fixture mock never touched.
    expect(networkFactory).toHaveBeenCalledTimes(1);
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it("returns null outside a provider (so callers fall back to the mock)", () => {
    const { result } = renderHook(() => useRepositoryContext());
    expect(result.current).toBeNull();
  });
});
