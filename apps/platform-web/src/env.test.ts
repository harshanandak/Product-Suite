import { describe, it, expect } from "vitest";

import { DEFAULT_WORKSPACE, hasClerkKey } from "./env";

describe("env", () => {
  it("defaults the workspace to befach-hq", () => {
    expect(DEFAULT_WORKSPACE).toBe("befach-hq");
  });

  it("hasClerkKey returns a boolean (false with no key in the test env)", () => {
    const result = hasClerkKey();
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });
});
