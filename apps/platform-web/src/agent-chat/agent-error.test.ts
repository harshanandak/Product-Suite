import { describe, expect, it } from "vitest";

import { isOrgRequiredError } from "./agent-error";

describe("isOrgRequiredError", () => {
  it("is true for the backend's 403 no-org body", () => {
    expect(
      isOrgRequiredError(new Error('{"error":"No active organization"}')),
    ).toBe(true);
  });
  it("is false for other errors / undefined", () => {
    expect(isOrgRequiredError(new Error("network down"))).toBe(false);
    expect(isOrgRequiredError(undefined)).toBe(false);
  });
});
