import { describe, expect, test } from "bun:test";

// Sidebar composes Radix primitives plus a React context provider/hook that
// require a browser environment to render, so we smoke-test the module here and
// exercise its behaviour in the app shell integration tests.
import * as Sidebar from "./sidebar";

describe("ui Sidebar module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(Sidebar);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });

  test("exposes the useSidebar hook", () => {
    expect(typeof Sidebar.useSidebar).toBe("function");
  });
});
