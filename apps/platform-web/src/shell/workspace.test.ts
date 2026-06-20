import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE } from "../env";
import { workspaceSlugFromOrg } from "./workspace";

describe("workspaceSlugFromOrg", () => {
  it("uses the active org's slug (org ↔ workspace 1:1)", () => {
    expect(workspaceSlugFromOrg({ slug: "acme-inc" })).toBe("acme-inc");
  });

  it("falls back to the default workspace when there is no org or slug", () => {
    expect(workspaceSlugFromOrg(null)).toBe(DEFAULT_WORKSPACE);
    expect(workspaceSlugFromOrg(undefined)).toBe(DEFAULT_WORKSPACE);
    expect(workspaceSlugFromOrg({ slug: null })).toBe(DEFAULT_WORKSPACE);
    expect(workspaceSlugFromOrg({ slug: "   " })).toBe(DEFAULT_WORKSPACE);
  });
});
