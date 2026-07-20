import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AskAgentProvider } from "./ask-agent";
import { useAskAgent } from "./use-ask-agent";

describe("useAskAgent", () => {
  it("throws when used outside an AskAgentProvider (fails loudly, not silently)", () => {
    // Silence React's expected error-boundary console output for this throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAskAgent())).toThrow(
      /must be used within an AskAgentProvider/,
    );
    spy.mockRestore();
  });

  it("returns the provided invocation seam inside a provider", () => {
    const askAgent = vi.fn();
    const { result } = renderHook(() => useAskAgent(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AskAgentProvider value={askAgent}>{children}</AskAgentProvider>
      ),
    });
    expect(result.current).toBe(askAgent);
  });
});
