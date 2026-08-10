import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { parseNeonUrl } from "../scripts/check-database-authority.mjs";
import {
  analyzeRoleProvisioning,
  provisionDatabaseRoles,
} from "../scripts/provision-database-roles.mjs";

const requiredRuntimeRoles = [
  { rolname: "product_suite_platform_runtime", rolcanlogin: false },
  { rolname: "product_suite_meeting_runtime", rolcanlogin: false },
];

const neonAuthority = {
  rolname: "neondb_owner",
  rolcanlogin: true,
  rolcreaterole: true,
};

describe("database role provisioning", () => {
  test("accepts nested non-AWS Neon hosts and preserves direct/pooler endpoint identity", () => {
    expect(parseNeonUrl(
      "postgresql://owner:secret@ep-safe-compute.eu-central-1.azure.neon.tech/neondb?sslmode=require",
      "migration",
    )).toMatchObject({ provider: "neon", purpose: "migration", endpointId: "safe-compute" });
    expect(parseNeonUrl(
      "postgresql://owner:secret@ep-safe-compute-pooler.eu-central-1.azure.neon.tech/neondb?sslmode=require",
      "runtime",
    )).toMatchObject({ provider: "neon", purpose: "runtime", endpointId: "safe-compute" });
    for (const hostname of [
      "ep-safe-compute.eu-central-1.azure.neon.tech.evil.example",
      "ep-safe-compute.eu-central-1.azure.neon.tech.",
    ]) {
      expect(() => parseNeonUrl(
        `postgresql://owner:secret@${hostname}/neondb?sslmode=require`,
        "migration",
      )).toThrow("DATABASE_PROVIDER_INVALID");
    }
  });

  test("reaches BEGIN for a valid nested Neon migration host", async () => {
    const calls = [];
    const result = await provisionDatabaseRoles({
      adapter: {
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("current_user AS rolname")) return { rows: [{ rolname: "neondb_owner", rolcanlogin: true, rolcreaterole: false, rolsuper: false, rolcreatedb: true, neon_superuser: true }] };
          if (sql.includes("FROM pg_roles r") && sql.includes("product_suite_platform_runtime")) return {
            rows: [
              { rolname: "product_suite_platform_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
              { rolname: "product_suite_meeting_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
            ],
          };
          return { rows: [] };
        },
      },
      databaseUrl: "postgresql://owner:secret@ep-safe-compute.eu-central-1.azure.neon.tech/neondb?sslmode=require",
    });
    expect(result).toMatchObject({ ok: true, status: "READY" });
    expect(calls[0]).toBe("BEGIN;");
  });

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

  test("accepts Neon API-created owners through neon_superuser membership", () => {
    const evidence = analyzeRoleProvisioning({
      admin: { rolname: "neondb_owner", rolcanlogin: true, rolcreaterole: false, neon_superuser: true },
      roles: requiredRuntimeRoles,
    });
    expect(evidence).toMatchObject({ ok: true, status: "READY" });
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

  test("accepts and excludes PostgreSQL 17 creator edges for both runtime roles", () => {
    const evidence = analyzeRoleProvisioning({
      admin: neonAuthority,
      roles: requiredRuntimeRoles,
      memberships: requiredRuntimeRoles.map(({ rolname }) => ({
        member: "neondb_owner",
        role: rolname,
        admin_option: true,
        inherit_option: false,
        set_option: false,
      })),
    });

    expect(evidence).toMatchObject({ ok: true, memberships: [] });
  });

  for (const [label, membership] of [
    ["ADMIN false", { admin_option: false, inherit_option: false, set_option: false }],
    ["INHERIT true", { admin_option: true, inherit_option: true, set_option: false }],
    ["SET true", { admin_option: true, inherit_option: false, set_option: true }],
    ["missing INHERIT", { admin_option: true, set_option: false }],
    ["missing SET", { admin_option: true, inherit_option: false }],
    ["different member", { member: "other_owner", admin_option: true, inherit_option: false, set_option: false }],
  ]) {
    test(`rejects unsafe creator edge with ${label}`, () => {
      expect(() => analyzeRoleProvisioning({
        admin: neonAuthority,
        roles: requiredRuntimeRoles,
        memberships: [{
          member: "neondb_owner",
          role: "product_suite_platform_runtime",
          ...membership,
        }],
      })).toThrow("UNAUTHORIZED_LOGIN_MEMBERSHIP");
    });
  }

  test("preserves runtime-login membership rejection rules", () => {
    const snapshot = (membership, allowedLogins = []) => ({
      admin: neonAuthority,
      roles: requiredRuntimeRoles,
      memberships: [membership],
      allowedLogins,
    });

    expect(() => analyzeRoleProvisioning(snapshot({
      member: "unknown_login",
      role: "product_suite_platform_runtime",
      admin_option: false,
    }))).toThrow("UNAUTHORIZED_LOGIN_MEMBERSHIP");
    expect(() => analyzeRoleProvisioning(snapshot({
      member: "platform_login",
      role: "product_suite_platform_runtime",
      admin_option: true,
    }, ["platform_login"]))).toThrow("ADMIN_OPTION_MEMBERSHIP_FORBIDDEN");
    expect(() => analyzeRoleProvisioning(snapshot({
      member: "meeting_login",
      role: "product_suite_platform_runtime",
      admin_option: false,
    }, ["meeting_login"]))).toThrow("WRONG_LOGIN_MEMBERSHIP");
  });

  test("uses a database adapter and never returns credentials", async () => {
    const calls = [];
    const result = await provisionDatabaseRoles({
      adapter: {
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("current_user AS rolname")) return { rows: [{ rolname: "neondb_owner", rolcanlogin: true, rolcreaterole: false, rolsuper: false, rolcreatedb: true, neon_superuser: true }] };
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
    const membershipQuery = calls.find((sql) => sql.includes("JOIN pg_roles member"));
    expect(membershipQuery).toContain("m.inherit_option");
    expect(membershipQuery).toContain("m.set_option");
    expect(calls.find((sql) => sql.includes("current_user AS rolname"))).toContain("parent.rolname = 'neon_superuser'");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  const roleProvisionStepCases = [
    ["begin", "ROLE_PROVISION_BEGIN_FAILED"],
    ["authority-read", "ROLE_PROVISION_AUTHORITY_FAILED"],
    ["authority-validate", "ROLE_PROVISION_AUTHORITY_FAILED"],
    ["lock", "ROLE_PROVISION_LOCK_FAILED"],
    ["create", "ROLE_PROVISION_CREATE_ROLES_FAILED"],
    ["grant", "ROLE_PROVISION_GRANTS_FAILED"],
    ["role-state", "ROLE_PROVISION_ROLE_STATE_FAILED"],
    ["membership-read", "ROLE_PROVISION_MEMBERSHIP_FAILED"],
    ["membership-validate", "ROLE_PROVISION_MEMBERSHIP_FAILED"],
    ["commit", "ROLE_PROVISION_COMMIT_FAILED"],
  ];

  for (const [step, code] of roleProvisionStepCases) {
    test(`redacts ${step} as ${code}`, async () => {
      const adapter = {
        query: async (sql) => {
          const fail = () => { throw new Error("secret https://neon.example/projects/prod token=opaque"); };
          if (step === "begin" && sql === "BEGIN;") fail();
          if (step === "authority-read" && sql.includes("current_user AS rolname")) fail();
          if (sql.includes("current_user AS rolname")) {
            return { rows: [{ rolname: "neondb_owner", rolcanlogin: step !== "authority-validate", rolcreaterole: false, rolsuper: false, rolcreatedb: true, neon_superuser: true }] };
          }
          if (step === "lock" && sql.includes("pg_advisory_xact_lock")) fail();
          if (step === "create" && sql.startsWith("\nDO $$")) fail();
          if (step === "grant" && sql.startsWith("GRANT ")) fail();
          if (step === "role-state" && sql.includes("product_suite_platform_runtime") && sql.includes("FROM pg_roles r")) fail();
          if (step === "membership-read" && sql.includes("JOIN pg_roles member")) fail();
          if (sql.includes("product_suite_platform_runtime") && sql.includes("FROM pg_roles r")) return {
            rows: [
              { rolname: "product_suite_platform_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
              { rolname: "product_suite_meeting_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
            ],
          };
          if (step === "membership-validate" && sql.includes("JOIN pg_roles member")) return {
            rows: [{ member: "unknown_login", role: "product_suite_platform_runtime", admin_option: false, inherit_option: false, set_option: false }],
          };
          if (step === "commit" && sql === "COMMIT;") fail();
          if (step === "role-state" && sql === "ROLLBACK;") fail();
          return { rows: [] };
        },
      };
      await expect(provisionDatabaseRoles({
        adapter,
        platformLogin: "platform_runtime_login",
        meetingLogin: "meeting_runtime_login",
      })).rejects.toThrow(code);
    });
  }

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
    })).rejects.toThrow("ROLE_PROVISION_AUTHORITY_FAILED");
  });
});
