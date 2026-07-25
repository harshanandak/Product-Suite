import { renderHook } from "@testing-library/react";
import { useContext, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { MeetingActionsRepositoryContext } from "./meeting-actions-repository-context";
import type { MeetingActionsRepository } from "./repository";

describe("MeetingActionsRepositoryContext", () => {
  it("defaults to null outside a provider (callers fall back to the mock repo)", () => {
    const { result } = renderHook(() =>
      useContext(MeetingActionsRepositoryContext),
    );
    expect(result.current).toBeNull();
  });

  it("exposes the injected repository to consumers", () => {
    const repo = { list: vi.fn() } as unknown as MeetingActionsRepository;
    const { result } = renderHook(
      () => useContext(MeetingActionsRepositoryContext),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <MeetingActionsRepositoryContext.Provider value={repo}>
            {children}
          </MeetingActionsRepositoryContext.Provider>
        ),
      },
    );
    expect(result.current).toBe(repo);
  });
});
