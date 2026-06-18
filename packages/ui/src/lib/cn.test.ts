import { describe, expect, test } from "bun:test";

import { cn } from "./cn.ts";

describe("cn className merge utility", () => {
  test("joins multiple class name strings", () => {
    expect(cn("px-2", "text-sm", "font-bold")).toBe("px-2 text-sm font-bold");
  });

  test("resolves conflicting Tailwind classes keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  test("flattens arrays of class values", () => {
    expect(cn(["px-2", "py-1"], "text-sm")).toBe("px-2 py-1 text-sm");
    expect(cn(["p-2", ["p-4"]])).toBe("p-4");
  });

  test("applies conditional class names via object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  test("ignores falsey values", () => {
    expect(cn("px-2", false, null, undefined, "", 0, "py-1")).toBe("px-2 py-1");
  });

  test("returns an empty string with no meaningful inputs", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined, "")).toBe("");
  });

  test("merges mixed arrays, conditionals, and conflicts together", () => {
    expect(
      cn("p-2", ["text-sm", { "font-bold": true, italic: false }], false, "p-4"),
    ).toBe("text-sm font-bold p-4");
  });
});
