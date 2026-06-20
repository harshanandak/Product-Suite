import { describe, expect, test } from "bun:test";

import * as mod from "./hover-card";

describe("hover-card", () => {
  test("module loads and exports at least one component", () => {
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
