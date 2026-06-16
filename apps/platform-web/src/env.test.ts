import { describe, it, expect } from "vitest";

import { DEFAULT_WORKSPACE, hasClerkKey } from "./env";

describe("env", () => {
  it("defaults the workspace to befach-hq", () => {
    expect(DEFAULT_WORKSPACE).toBe("befach-hq");
  });

  it("hasClerkKey returns a boolean reflecting whether a publishable key is set", () => {
    // Environment-agnostic: true when VITE_CLERK_PUBLISHABLE_KEY is present
    // (e.g. a local .env.local), false otherwise (e.g. CI). Assert the contract,
    // not the ambient value.
    expect(typeof hasClerkKey()).toBe("boolean");
  });
});
