import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test" }),
}));

import {
  ProposalRepositoryProvider,
  useProposalRepositoryContext,
} from "./ProposalRepositoryProvider";

describe("ProposalRepositoryProvider", () => {
  it("provides a network proposal repository to consumers inside the provider", () => {
    const { result } = renderHook(() => useProposalRepositoryContext(), {
      wrapper: ProposalRepositoryProvider,
    });
    expect(result.current).not.toBeNull();
    expect(typeof result.current?.list).toBe("function");
    expect(typeof result.current?.accept).toBe("function");
    expect(typeof result.current?.reject).toBe("function");
  });

  it("returns null outside a provider (so callers fall back to the mock)", () => {
    const { result } = renderHook(() => useProposalRepositoryContext());
    expect(result.current).toBeNull();
  });
});
