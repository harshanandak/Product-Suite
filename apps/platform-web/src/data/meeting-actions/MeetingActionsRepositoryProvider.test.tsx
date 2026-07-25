import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test" }),
}));

// Spy both adapter factories so we can prove the default (non-fixtures) path
// selects the NETWORK adapter and never builds the in-memory fixture mock —
// the shipped triage screen must read real meeting candidates.
const { networkFactory, mockFactory } = vi.hoisted(() => ({
  networkFactory: vi.fn(() => ({ list: vi.fn() })),
  mockFactory: vi.fn(() => ({ list: vi.fn() })),
}));
vi.mock("./network-repository", () => ({
  createNetworkMeetingActionsRepository: networkFactory,
}));
vi.mock("./repository", () => ({
  createMockMeetingActionsRepository: mockFactory,
}));

import {
  MeetingActionsRepositoryProvider,
  useMeetingActionsRepositoryContext,
} from "./MeetingActionsRepositoryProvider";

describe("MeetingActionsRepositoryProvider", () => {
  beforeEach(() => {
    networkFactory.mockClear();
    mockFactory.mockClear();
  });

  it("provides a meeting-actions repository to consumers inside the provider", () => {
    const { result } = renderHook(() => useMeetingActionsRepositoryContext(), {
      wrapper: MeetingActionsRepositoryProvider,
    });
    expect(result.current).not.toBeNull();
    expect(typeof result.current?.list).toBe("function");
  });

  it("selects the NETWORK repository (not the fixture mock) on the default path", () => {
    renderHook(() => useMeetingActionsRepositoryContext(), {
      wrapper: MeetingActionsRepositoryProvider,
    });
    expect(networkFactory).toHaveBeenCalledTimes(1);
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it("builds the adapter against the configured API base url and a live token", async () => {
    renderHook(() => useMeetingActionsRepositoryContext(), {
      wrapper: MeetingActionsRepositoryProvider,
    });

    const [options] = networkFactory.mock.calls[0] as unknown as [
      { baseUrl: string; getToken: () => Promise<string | null> },
    ];
    expect(typeof options.baseUrl).toBe("string");
    // Read through a ref, so a rotated Clerk token is always the one used.
    await expect(options.getToken()).resolves.toBe("tok_test");
  });

  it("returns null outside a provider (so callers fall back to the mock)", () => {
    const { result } = renderHook(() => useMeetingActionsRepositoryContext());
    expect(result.current).toBeNull();
  });
});
