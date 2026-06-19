import { describe, expect, test } from "bun:test";

import { Spinner } from "./spinner";

describe("spinner", () => {
  test("exports the Spinner component", () => {
    expect(Spinner).toBeDefined();
  });
});
