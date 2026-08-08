import { describe, expect, it } from "vitest";

import { getAdapterIdentity, shouldRetryServerStateQuery } from "./query-client";

describe("server-state policies", () => {
  it("allocates one stable primitive id per adapter object", () => {
    const first = {};
    const replacement = {};

    expect(getAdapterIdentity(first)).toBe(getAdapterIdentity(first));
    expect(getAdapterIdentity(replacement)).not.toBe(getAdapterIdentity(first));
    expect(typeof getAdapterIdentity(first)).toBe("number");
  });

  it.each([
    ["abort", 0, { name: "AbortError" }, false],
    ["client error", 0, { status: 401 }, false],
    ["unknown", 0, new Error("boom"), false],
    ["network first failure", 0, { name: "TypeError" }, true],
    ["timeout first failure", 0, { name: "TimeoutError" }, true],
    ["server first failure", 0, { status: 503 }, true],
    ["network second failure", 1, { name: "TypeError" }, false],
    ["timeout second failure", 1, { name: "TimeoutError" }, false],
    ["server second failure", 1, { status: 503 }, false],
  ])("classifies %s structurally", (_case, failureCount, error, expected) => {
    expect(shouldRetryServerStateQuery(failureCount, error)).toBe(expected);
  });
});
