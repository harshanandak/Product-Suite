import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test" }),
}));

// Spy both adapter factories so we can prove the default (non-fixtures) path
// selects the network adapter and never builds the in-memory fixture mock.
const { networkFactory, mockFactory } = vi.hoisted(() => ({
  networkFactory: vi.fn(() => ({
    list: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
  })),
  mockFactory: vi.fn(() => ({
    list: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
  })),
}));
vi.mock("./network-repository", () => ({
  createNetworkProposalRepository: networkFactory,
}));
vi.mock("./repository", () => ({
  createMockProposalRepository: mockFactory,
}));

import {
  ProposalRepositoryProvider,
  useProposalRepositoryContext,
} from "./ProposalRepositoryProvider";

describe("ProposalRepositoryProvider", () => {
  beforeEach(() => {
    networkFactory.mockClear();
    mockFactory.mockClear();
  });

  it("provides a network proposal repository to consumers inside the provider", () => {
    const { result } = renderHook(() => useProposalRepositoryContext(), {
      wrapper: ProposalRepositoryProvider,
    });
    expect(result.current).not.toBeNull();
    expect(typeof result.current?.list).toBe("function");
    expect(typeof result.current?.accept).toBe("function");
    expect(typeof result.current?.reject).toBe("function");
  });

  it("selects the NETWORK repository (not the fixture mock) on the default path", () => {
    renderHook(() => useProposalRepositoryContext(), {
      wrapper: ProposalRepositoryProvider,
    });
    expect(networkFactory).toHaveBeenCalledTimes(1);
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it("returns null outside a provider (so callers fall back to the mock)", () => {
    const { result } = renderHook(() => useProposalRepositoryContext());
    expect(result.current).toBeNull();
  });
});
