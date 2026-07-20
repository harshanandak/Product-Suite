import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";

import { AskAgentProvider } from "./ask-agent";
import { useAskAgent } from "./use-ask-agent";

describe("useAskAgent", () => {
  it("returns the provided seam inside a provider", () => {
    const askAgent = vi.fn();
    const { result } = renderHook(() => useAskAgent(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AskAgentProvider value={askAgent}>{children}</AskAgentProvider>
      ),
    });
    result.current({ prompt: "hi" });
    expect(askAgent).toHaveBeenCalledWith({ prompt: "hi" });
  });

  it("throws when used outside a provider so miswiring fails loudly", () => {
    // A consumer with no provider is a wiring bug — surface it, don't no-op.
    function Consumer() {
      useAskAgent();
      return null;
    }
    // Silence React's error-boundary console noise for the expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/AskAgentProvider/);
    spy.mockRestore();
    expect(screen.queryByText(/./)).toBeNull();
  });
});
