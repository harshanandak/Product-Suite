import { describe, expect, test } from "bun:test";
import { evaluateBaseFreshness } from "../scripts/base-freshness.mjs";

describe("base freshness verdict", () => {
  test("rejects a base that advances after the previous checks", () => {
    const result = evaluateBaseFreshness({
      expectedHead: "a".repeat(40),
      actualHead: "a".repeat(40),
      currentBase: "b".repeat(40),
      isAncestor: false,
    });
    expect(result).toEqual({ ok: false, code: "BASE_STALE" });
  });

  test("accepts an exact head when current base is an ancestor", () => {
    expect(
      evaluateBaseFreshness({
        expectedHead: "a".repeat(40),
        actualHead: "a".repeat(40),
        currentBase: "b".repeat(40),
        isAncestor: true,
      }),
    ).toEqual({ ok: true, code: "BASE_CURRENT" });
  });
});
