import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test" }),
}));

import { RepositoryProvider, useRepositoryContext } from "./RepositoryProvider";

describe("RepositoryProvider", () => {
  it("provides a network repository to consumers inside the provider", () => {
    const { result } = renderHook(() => useRepositoryContext(), {
      wrapper: RepositoryProvider,
    });
    expect(result.current).not.toBeNull();
    // The provided value satisfies the WorkItemRepository seam.
    expect(typeof result.current?.list).toBe("function");
    expect(typeof result.current?.create).toBe("function");
  });

  it("returns null outside a provider (so callers fall back to the mock)", () => {
    const { result } = renderHook(() => useRepositoryContext());
    expect(result.current).toBeNull();
  });
});
