import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test", orgId: "org_test" }),
}));

// Spy both adapter factories so we can prove the default (non-fixtures) path
// selects the network adapter and never builds the in-memory fixture mock.
const { networkFactory, mockFactory } = vi.hoisted(() => ({
  networkFactory: vi.fn(() => ({
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    supersede: vi.fn(),
    retract: vi.fn(),
    defer: vi.fn(),
  })),
  mockFactory: vi.fn(() => ({
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    supersede: vi.fn(),
    retract: vi.fn(),
    defer: vi.fn(),
  })),
}));
vi.mock("./adapter", () => ({ createMemoriesAdapter: networkFactory }));
vi.mock("./mock", () => ({ createMockMemoriesAdapter: mockFactory }));

import { MemoriesProvider, useMemoriesContext } from "./MemoriesProvider";

describe("MemoriesProvider", () => {
  beforeEach(() => {
    networkFactory.mockClear();
    mockFactory.mockClear();
  });

  it("provides a network memories adapter to consumers inside the provider", () => {
    const { result } = renderHook(() => useMemoriesContext(), {
      wrapper: MemoriesProvider,
    });
    expect(result.current).not.toBeNull();
    expect(typeof result.current?.list).toBe("function");
    expect(typeof result.current?.create).toBe("function");
    expect(typeof result.current?.supersede).toBe("function");
  });

  it("selects the NETWORK adapter (not the fixture mock) on the default path", () => {
    renderHook(() => useMemoriesContext(), { wrapper: MemoriesProvider });
    expect(networkFactory).toHaveBeenCalledTimes(1);
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it("returns null outside a provider (so callers fall back to the mock)", () => {
    const { result } = renderHook(() => useMemoriesContext());
    expect(result.current).toBeNull();
  });
});
