import { renderHook } from "@testing-library/react";
import { useContext, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProposalRepositoryContext } from "./proposal-repository-context";
import type { ProposalRepository } from "./repository";

describe("ProposalRepositoryContext", () => {
  it("defaults to null outside a provider (callers fall back to the mock repo)", () => {
    const { result } = renderHook(() => useContext(ProposalRepositoryContext));
    expect(result.current).toBeNull();
  });

  it("exposes the injected repository to consumers", () => {
    const repo = { list: vi.fn() } as unknown as ProposalRepository;
    const { result } = renderHook(() => useContext(ProposalRepositoryContext), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ProposalRepositoryContext.Provider value={repo}>
          {children}
        </ProposalRepositoryContext.Provider>
      ),
    });
    expect(result.current).toBe(repo);
  });
});
