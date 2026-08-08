import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useServerState } from "./context";

describe("useServerState", () => {
  it("returns the stable fixture fallback outside a provider", () => {
    const first = renderHook(() => useServerState()).result.current;
    const second = renderHook(() => useServerState()).result.current;

    expect(first).toBe(second);
    expect(first.scope).toMatchObject({
      key: "fixtures",
      mode: "fixtures",
      orgId: "fixture-org",
      principalId: "fixture-user",
    });
  });
});
