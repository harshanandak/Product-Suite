import { describe, expect, test } from "bun:test";

// DropdownMenu is a Radix UI portal/context primitive that requires a browser
// environment to render, so we smoke-test the module here and exercise its
// behaviour in the app shell integration tests.
import * as DropdownMenu from "./dropdown-menu";

describe("ui DropdownMenu module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(DropdownMenu);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });
});
