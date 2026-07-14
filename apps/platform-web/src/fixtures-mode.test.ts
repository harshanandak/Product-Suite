import { describe, expect, it } from "vitest";

import { USE_FIXTURES } from "./fixtures-mode";

describe("USE_FIXTURES", () => {
  it("is OFF unless explicitly opted in (VITE_USE_FIXTURES unset in the test env)", () => {
    // The auth bypass + fixtures MUST default to off. VITE_USE_FIXTURES is unset
    // under the test/dev env, so the guard is false — which is precisely why every
    // other provider/shell test in the suite exercises the normal Clerk/network
    // path unchanged. (In production `import.meta.env.DEV` is compile-time false,
    // so the guard folds to false there regardless of the env var.)
    expect(USE_FIXTURES).toBe(false);
  });
});
