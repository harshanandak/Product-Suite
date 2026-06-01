import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  authCoreContract,
  clerkEnvironmentContract,
  validateAuthClaims,
  validateClerkEnvironment,
} from "./auth.js";

describe("authCoreContract", () => {
  test("matches the committed auth contract artifact", () => {
    const authArtifact = JSON.parse(
      readFileSync(new URL("../contracts/auth-core.json", import.meta.url), "utf8"),
    );

    expect(authCoreContract).toEqual(authArtifact);
    expect(authCoreContract.claims.requiredKeys).toEqual(["provider", "subject"]);
    expect(authCoreContract.tokenVerifier.failureKey).toBe("auth_error");
    expect(authCoreContract.sessionBridge.tokenKey).toBe("access_token");
    expect(authCoreContract.workspaceAccessResolver.resultKey).toBe("workspace_access");
  });

  test("validates required shared auth claims", () => {
    const result = validateAuthClaims({
      provider: "hosted",
      subject: "user_123",
      email: "user@example.com",
      tenant_id: "tenant_123",
      workspace_ids: ["workspace_123"],
      roles: ["member"],
    });

    expect(result.ok).toBe(true);
    expect(result.claims.provider).toBe("hosted");
    expect(result.claims.subject).toBe("user_123");
    expect(result.claims.workspace_ids).toEqual(["workspace_123"]);
    expect(result.claims.roles).toEqual(["member"]);
  });

  test("normalizes canonical hosted auth claims without token leakage", () => {
    const result = validateAuthClaims({
      provider: "neon",
      subject: "user_123",
      issuer: "https://project-123.neon.tech",
      audience: "meeting-api",
      email: "user@example.com",
      tenant_id: "tenant_123",
      workspace_ids: "workspace_123",
      roles: ["admin", ""],
      permissions: ["meetings:read", "meetings:write"],
      issued_at: 1_770_000_000,
      expires_at: 1_770_003_600,
      jwt_id: "jwt_123",
      provider_claims: {
        organization_id: "tenant_123",
        provider: "neon",
      },
      access_token: "secret-token-value",
    });

    expect(result.ok).toBe(true);
    expect(result.claims).toMatchObject({
      provider: "neon",
      subject: "user_123",
      issuer: "https://project-123.neon.tech",
      audience: ["meeting-api"],
      tenant_id: "tenant_123",
      workspace_ids: ["workspace_123"],
      roles: ["admin"],
      permissions: ["meetings:read", "meetings:write"],
      issued_at: 1_770_000_000,
      expires_at: 1_770_003_600,
      jwt_id: "jwt_123",
      provider_claims: {
        organization_id: "tenant_123",
        provider: "neon",
      },
    });
    expect(JSON.stringify(result.claims)).not.toContain("secret-token-value");
  });

  test("fails closed without required shared auth claims", () => {
    const result = validateAuthClaims({
      provider: "hosted",
      access_token: "secret-token-value",
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("AUTH_CLAIMS_INVALID");
    expect(result.error.missing).toEqual(["subject"]);
    expect(JSON.stringify(result)).not.toContain("secret-token-value");
  });

  test("validates protected Clerk runtime environment without leaking secrets", () => {
    const result = validateClerkEnvironment({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      CLERK_SECRET_KEY: "sk_test_secret",
      CLERK_ISSUER: "https://clerk.example.com",
      CLERK_AUDIENCE: "product-suite",
      CLERK_AUTHORIZED_PARTIES: "https://app.example.com,https://preview.example.com",
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
    });

    expect(result.ok).toBe(true);
    expect(result.environment).toMatchObject({
      provider: "clerk",
      publishableKey: "pk_test_public",
      issuer: "https://clerk.example.com",
      audience: ["product-suite"],
      authorizedParties: ["https://app.example.com", "https://preview.example.com"],
      secretKeyConfigured: true,
      signInUrl: "/sign-in",
      signUpUrl: "/sign-up",
    });
    expect(JSON.stringify(result)).not.toContain("sk_test_secret");
  });

  test("fails closed when protected Clerk runtime settings are missing", () => {
    const result = validateClerkEnvironment({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      CLERK_SECRET_KEY: "sk_test_secret",
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("CLERK_ENV_INVALID");
    expect(result.error.missing).toEqual([
      clerkEnvironmentContract.keys.issuer,
      clerkEnvironmentContract.keys.audience,
      clerkEnvironmentContract.keys.authorizedParties,
    ]);
    expect(JSON.stringify(result)).not.toContain("sk_test_secret");
  });

  test("keeps public-only Clerk shell settings separate from protected runtime secrets", () => {
    const result = validateClerkEnvironment(
      {
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
        NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
      },
      { protectedRuntime: false },
    );

    expect(result.ok).toBe(true);
    expect(result.environment).toMatchObject({
      provider: "clerk",
      publishableKey: "pk_test_public",
      secretKeyConfigured: false,
      signInUrl: "/sign-in",
      signUpUrl: "/sign-up",
    });
  });
});
