import { describe, expect, test } from "bun:test";

// Tabs is a Radix UI context primitive that requires a browser environment to
// render, so we smoke-test the module here and exercise its behaviour in the
// app shell integration tests.
import * as Tabs from "./tabs";

describe("ui Tabs module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(Tabs);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });
});
