#!/usr/bin/env node

import { parseNeonUrl } from "./check-database-authority.mjs";
import { createDatabasePool } from "./database-pool.mjs";
import { createRoleProvisioningEvidence } from "./migration-evidence.mjs";

export const REQUIRED_GRANT_ROLES = Object.freeze([
  "product_suite_platform_runtime",
  "product_suite_meeting_runtime",
]);

const DEFAULT_LOGIN_ROLES = new Set([
  "deploy_login",
  "platform_login",
  "meeting_login",
  "platform_runtime_login",
  "meeting_runtime_login",
  "product_suite_platform_login",
  "product_suite_meeting_login",
]);

function redactError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const code = error?.code || (/^(?:SQL_|CREATEROLE_|ROLE_|UNAUTHORIZED_|ADMIN_OPTION_|WRONG_LOGIN_)/.test(message) ? message : "ROLE_PROVISIONING_FAILED");
  return new Error(code);
}

function memberName(membership) {
  return membership?.member ?? membership?.rolname ?? membership?.login ?? membership?.grantee;
}

function roleName(role) {
  return role?.rolname ?? role?.role ?? role?.name;
}

function normalizeAllowedLogins(options = {}) {
  const explicit = options.allowedLogins ?? options.loginRoles ?? options.authorizedLogins;
  if (Array.isArray(explicit) && explicit.length > 0) return new Set(explicit);
  const values = [
    options.platformLogin,
    options.meetingLogin,
    process.env.PLATFORM_RUNTIME_LOGIN_ROLE,
    process.env.MEETING_RUNTIME_LOGIN_ROLE,
    process.env.PLATFORM_DATABASE_LOGIN_ROLE,
    process.env.MEETING_DATABASE_LOGIN_ROLE,
  ].filter(Boolean);
  return new Set([...DEFAULT_LOGIN_ROLES, ...values]);
}

function validateAuthority(admin = {}, snapshot = {}) {
  const authorityName = admin.rolname ?? admin.role ?? admin.name;
  if (authorityName && authorityName !== "neondb_owner" && admin.approvedEquivalent !== true) throw new Error("SQL_AUTHORITY_ROLE_INVALID");
  const canCreateRoles = admin.rolcreaterole === true || admin.createrole === true || admin.canCreateRole === true;
  const hasAdminOption = admin.admin_option === true || admin.adminOption === true || admin.isAdmin === true ||
    (snapshot.adminMemberships ?? snapshot.memberships ?? []).some((membership) =>
      authorityName && memberName(membership) === authorityName && (membership.admin_option === true || membership.adminOption === true));
  if (admin.rolcanlogin !== true && admin.canLogin !== true) throw new Error("SQL_AUTHORITY_LOGIN_REQUIRED");
  if (!canCreateRoles && !hasAdminOption) throw new Error("CREATEROLE_OR_ADMIN_OPTION_REQUIRED");
}

/**
 * Validate a snapshot returned by pg_catalog.  It is deliberately pure so
 * tests can exercise all privilege cases without a database.
 */
export function analyzeRoleProvisioning(snapshot = {}) {
  const admin = snapshot.admin ?? snapshot.authority ?? {};
  validateAuthority(admin, snapshot);

  const roles = new Map((snapshot.roles ?? []).map((role) => [roleName(role), role]));
  for (const required of REQUIRED_GRANT_ROLES) {
    const role = roles.get(required);
    if (!role) throw new Error(`ROLE_MISSING:${required}`);
    if (role.rolcanlogin === true || role.canLogin === true) throw new Error(`ROLE_MUST_BE_NOLOGIN:${required}`);
    if (role.rolsuper === true || role.rolcreaterole === true || role.rolcreatedb === true) throw new Error(`ROLE_PRIVILEGE_ESCALATION:${required}`);
  }

  const allowed = normalizeAllowedLogins(snapshot);
  const memberships = snapshot.memberships ?? [];
  const evidenceMemberships = [];
  for (const membership of memberships) {
    const member = memberName(membership);
    const parent = membership.role ?? membership.parent ?? membership.grantedRole;
    if (!REQUIRED_GRANT_ROLES.includes(parent)) continue;
    if (!member || !allowed.has(member)) throw new Error("UNAUTHORIZED_LOGIN_MEMBERSHIP");
    if (membership.admin_option === true || membership.adminOption === true) throw new Error("ADMIN_OPTION_MEMBERSHIP_FORBIDDEN");
    const looksPlatform = /platform/i.test(parent);
    const looksMeeting = /meeting/i.test(parent);
    if ((looksPlatform && /meeting/i.test(member)) || (looksMeeting && /platform/i.test(member))) throw new Error("WRONG_LOGIN_MEMBERSHIP");
    evidenceMemberships.push({ member, role: parent });
  }

  return {
    ok: true,
    status: "READY",
    roles: REQUIRED_GRANT_ROLES.map((role) => ({ role, login: false })),
    memberships: evidenceMemberships,
  };
}

const ROLE_STATE_SQL = `
SELECT
  current_user,
  r.rolname,
  r.rolcanlogin,
  r.rolsuper,
  r.rolcreaterole,
  r.rolcreatedb
FROM pg_roles r
WHERE r.rolname IN ('product_suite_platform_runtime', 'product_suite_meeting_runtime')
ORDER BY r.rolname;
`;

// Never infer authority from a caller-provided/default snapshot.  The role
// attributes are read from pg_catalog in the same transaction that provisions
// the runtime roles, so a missing row fails closed.
const AUTHORITY_SQL = `
SELECT
  current_user AS rolname,
  r.rolcanlogin,
  r.rolsuper,
  r.rolcreaterole,
  r.rolcreatedb,
  EXISTS (
    SELECT 1
    FROM pg_auth_members m
    WHERE m.member = r.oid AND m.admin_option
  ) AS admin_option
FROM pg_roles r
WHERE r.rolname = current_user;
`;

const MEMBERSHIP_SQL = `
SELECT member.rolname AS member, parent.rolname AS role, m.admin_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE parent.rolname IN ('product_suite_platform_runtime', 'product_suite_meeting_runtime')
ORDER BY member.rolname, parent.rolname;
`;

const CREATE_ROLES_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_suite_platform_runtime') THEN
    CREATE ROLE product_suite_platform_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_suite_meeting_runtime') THEN
    CREATE ROLE product_suite_meeting_runtime NOLOGIN;
  END IF;
END
$$;
`;

function quoteRoleIdentifier(value) {
  if (typeof value !== "string" || !/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("LOGIN_ROLE_NAME_INVALID");
  return `"${value}"`;
}

/**
 * Provision/validate grant roles using a direct SQL authority.  The adapter
 * contract is intentionally tiny (`query(sql, params?)`); callers own the
 * connection lifecycle and credentials stay outside this module.
 */
export async function provisionDatabaseRoles({ adapter, databaseUrl, environment = process.env.DATABASE_ENVIRONMENT ?? "production", snapshot, allowedLogins, platformLogin = process.env.PLATFORM_RUNTIME_LOGIN_ROLE, meetingLogin = process.env.MEETING_RUNTIME_LOGIN_ROLE } = {}) {
  if (databaseUrl) {
    try {
      parseNeonUrl(databaseUrl, "migration");
    } catch (error) {
      let local = false;
      try { local = ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname); } catch { /* redact below */ }
      if (environment === "production" || !local) throw error;
    }
  }
  if (!adapter || typeof adapter.query !== "function") throw new Error("DATABASE_ADAPTER_REQUIRED");

  if (snapshot) {
    const result = analyzeRoleProvisioning({ ...snapshot, allowedLogins, platformLogin, meetingLogin });
    return createRoleProvisioningEvidence({ count: result.roles.length });
  }

  const run = async (sql, params) => {
    try {
      return await adapter.query(sql, params);
    } catch (error) {
      throw redactError(error);
    }
  };

  await run("BEGIN;");
  try {
    const authorityRows = await run(AUTHORITY_SQL);
    const authorityRow = authorityRows?.rows?.[0];
    if (!authorityRow) throw new Error("SQL_AUTHORITY_NOT_FOUND");
    let localAuthority = false;
    try { localAuthority = ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl ?? "").hostname); } catch { /* URL validation above owns the error */ }
    // Local CI uses PostgreSQL's `postgres` owner.  It is still read from
    // pg_catalog; only this explicitly non-production local authority is an
    // approved equivalent to Neon `neondb_owner`.
    const authority = localAuthority && environment !== "production"
      ? { ...authorityRow, approvedEquivalent: true }
      : authorityRow;
    validateAuthority(authority, { allowedLogins, platformLogin, meetingLogin });
    await run("SELECT pg_advisory_xact_lock(hashtext('product-suite:database-roles'));");
    await run(CREATE_ROLES_SQL);
    if (platformLogin) await run(`GRANT ${quoteRoleIdentifier("product_suite_platform_runtime")} TO ${quoteRoleIdentifier(platformLogin)};`);
    if (meetingLogin) await run(`GRANT ${quoteRoleIdentifier("product_suite_meeting_runtime")} TO ${quoteRoleIdentifier(meetingLogin)};`);
    const roleRows = await run(ROLE_STATE_SQL);
    const membershipRows = await run(MEMBERSHIP_SQL);
    analyzeRoleProvisioning({
      admin: authority,
      roles: roleRows?.rows ?? [],
      memberships: membershipRows?.rows ?? [],
      allowedLogins,
      platformLogin,
      meetingLogin,
    });
    await run("COMMIT;");
  } catch (error) {
    try { await run("ROLLBACK;"); } catch { /* preserve the original fail-closed error */ }
    throw redactError(error);
  }

  return createRoleProvisioningEvidence({ count: REQUIRED_GRANT_ROLES.length });
}

export const provisionRoles = provisionDatabaseRoles;

if (process.argv[1] && process.argv[1].endsWith("provision-database-roles.mjs")) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error("MIGRATION_DATABASE_URL is required");
    process.exitCode = 1;
  } else {
    try {
      const environment = process.env.DATABASE_ENVIRONMENT ?? "production";
      const pool = await createDatabasePool({ databaseUrl: url, environment });
      const result = await provisionDatabaseRoles({ adapter: pool, databaseUrl: url, environment });
      console.log(JSON.stringify(result));
      await pool.end();
    } catch (error) {
      console.error(`database role provisioning failed: ${error?.message || "unknown"}`);
      process.exitCode = 1;
    }
  }
}
