import { describe, expect, test } from "bun:test";

import {
  analyzeRoleProvisioning,
  provisionDatabaseRoles,
} from "../scripts/provision-database-roles.mjs";

describe("database role provisioning", () => {
  test("fails closed when the admin lacks CREATEROLE", () => {
    expect(() => analyzeRoleProvisioning({
      admin: { rolcanlogin: true, rolsuper: true, rolcreaterole: false },
      roles: [],
    })).toThrow("CREATEROLE");
  });

  test("fails closed when a required NOLOGIN role is a LOGIN role", () => {
    expect(() => analyzeRoleProvisioning({
      admin: { rolcanlogin: true, rolsuper: true, rolcreaterole: true },
      roles: [{ rolname: "product_suite_platform_runtime", rolcanlogin: true }],
    })).toThrow("NOLOGIN");
  });

  test("accepts idempotent roles and returns redacted evidence", () => {
    const evidence = analyzeRoleProvisioning({
      admin: { rolcanlogin: true, rolsuper: true, rolcreaterole: true },
      roles: [
        { rolname: "product_suite_platform_runtime", rolcanlogin: false },
        { rolname: "product_suite_meeting_runtime", rolcanlogin: false },
      ],
      memberships: [{ member: "deploy_login", role: "product_suite_platform_runtime", admin_option: false }],
    });
    expect(evidence.ok).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain("postgresql://");
    expect(JSON.stringify(evidence)).not.toContain("password");
  });

  test("uses a database adapter and never returns credentials", async () => {
    const calls = [];
    const result = await provisionDatabaseRoles({
      adapter: {
        query: async (sql) => { calls.push(sql); return { rows: [] }; },
      },
      databaseUrl: "postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require",
    });
    expect(result.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
