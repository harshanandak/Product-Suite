import { describe, expect, test } from "bun:test";

// useIsMobile relies on window.matchMedia, so its behaviour is exercised in the
// app shell integration tests (real DOM). Here we assert it is exported as a
// hook so the module stays wired into the public surface.
import { useIsMobile } from "./use-mobile";

describe("useIsMobile", () => {
  test("is exported as a hook function", () => {
    expect(typeof useIsMobile).toBe("function");
  });
});
