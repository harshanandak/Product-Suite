import { describe, expect, test } from "bun:test";

import * as mod from "./input-group";

describe("input-group", () => {
  test("module loads and exports at least one component", () => {
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
