import { describe, expect, test } from "vitest";

import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";

describe("hosted auth adapter import", () => {
  test("imports and constructs the Better Auth React adapter from the Neon export path", () => {
    const adapterFactory = BetterAuthReactAdapter();
    const adapter = adapterFactory("https://project-123.neon.tech/auth");

    expect(adapterFactory).toBeTypeOf("function");
    expect(adapter).toBeTruthy();
    expect(adapter).toHaveProperty("getBetterAuthInstance");
    expect(adapter.getBetterAuthInstance).toBeTypeOf("function");
  });
});
