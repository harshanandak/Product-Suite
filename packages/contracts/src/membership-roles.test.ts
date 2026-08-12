import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  MEMBERSHIP_ROLE_VALUES,
  isMembershipRole,
  parseMembershipRole,
} from "./index.js";

describe("canonical membership roles", () => {
  test("accepts exactly viewer, member, admin, and owner", () => {
    expect(MEMBERSHIP_ROLE_VALUES).toEqual(["viewer", "member", "admin", "owner"]);

    for (const role of MEMBERSHIP_ROLE_VALUES) {
      expect(isMembershipRole(role)).toBe(true);
      expect(parseMembershipRole(role)).toBe(role);
    }
  });

  test("keeps the TypeScript union aligned with the runtime contract", () => {
    const declarations = readFileSync(new URL("./index.d.ts", import.meta.url), "utf8");
    expect(declarations).toContain(
      'export type MembershipRole = "viewer" | "member" | "admin" | "owner";',
    );
  });

  test.each([
    "org_admin",
    "",
    "editor",
    "ADMIN",
    " admin ",
    null,
    1,
    {},
  ])("rejects non-canonical role %#", (role) => {
    expect(isMembershipRole(role)).toBe(false);
    expect(() => parseMembershipRole(role)).toThrow("Invalid membership role");
  });
});
