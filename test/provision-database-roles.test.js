import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  analyzeRoleProvisioning,
  provisionDatabaseRoles,
} from "../scripts/provision-database-roles.mjs";

describe("database role provisioning", () => {
  test("declares the Neon driver at the root because the provisioning script imports it directly", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );

    expect(
      { ...packageJson.dependencies, ...packageJson.devDependencies }[
        "@neondatabase/serverless"
      ],
    ).toBeDefined();
  });

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
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("current_user AS rolname")) return { rows: [{ rolname: "neondb_owner", rolcanlogin: true, rolcreaterole: true, rolsuper: true, rolcreatedb: true }] };
          if (sql.includes("FROM pg_roles r") && sql.includes("product_suite_platform_runtime")) return {
            rows: [
              { rolname: "product_suite_platform_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
              { rolname: "product_suite_meeting_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
            ],
          };
          return { rows: [] };
        },
      },
      databaseUrl: "postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require",
    });
    expect(result).toMatchObject({ ok: true, operation: "provision-roles", status: "READY" });
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("accepts a non-production IPv6 loopback PostgreSQL authority", async () => {
    const result = await provisionDatabaseRoles({
      adapter: {
        query: async (sql) => {
          if (sql.includes("current_user AS rolname")) return { rows: [{ rolname: "postgres", rolcanlogin: true, rolcreaterole: true }] };
          if (sql.includes("FROM pg_roles r") && sql.includes("product_suite_platform_runtime")) return {
            rows: [
              { rolname: "product_suite_platform_runtime", rolcanlogin: false },
              { rolname: "product_suite_meeting_runtime", rolcanlogin: false },
            ],
          };
          return { rows: [] };
        },
      },
      databaseUrl: "postgresql://postgres:secret@[::1]:5432/app",
      environment: "test",
    });

    expect(result).toMatchObject({ ok: true, operation: "provision-roles", status: "READY" });
  });

  test("fails closed when the database cannot report current_user authority", async () => {
    await expect(provisionDatabaseRoles({
      adapter: { query: async () => ({ rows: [] }) },
      databaseUrl: "postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require",
    })).rejects.toThrow("SQL_AUTHORITY_NOT_FOUND");
  });
});
