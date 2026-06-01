import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  authCoreContract,
  authRedirectContract,
  clerkJwtVerificationContract,
  clerkEnvironmentContract,
  extractClerkSessionToken,
  platformEventIdentityContract,
  platformIdentitySyncContract,
  validateAuthClaims,
  validateAuthReturnIntent,
  validateClerkEnvironment,
  validateClerkJwtPayload,
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

  test("normalizes canonical Clerk claims for backend verification", () => {
    const result = validateAuthClaims(
      {
        provider: "clerk",
        subject: "user_123",
        issuer: "https://clerk.example.com",
        audience: "product-suite",
        authorized_party: "https://app.example.com",
        email: "user@example.com",
        display_name: "Example User",
        tenant_id: "org_123",
        workspace_ids: "workspace_123",
        roles: ["admin"],
        permissions: ["meetings:read"],
        issued_at: 1_770_000_000,
        expires_at: 1_770_003_600,
        jwt_id: "jwt_123",
        provider_claims: {
          organization_id: "org_123",
          provider: "clerk",
        },
        access_token: "secret-token-value",
      },
      { requireClerkVerification: true },
    );

    expect(result.ok).toBe(true);
    expect(result.claims).toMatchObject({
      provider: "clerk",
      subject: "user_123",
      issuer: "https://clerk.example.com",
      audience: ["product-suite"],
      authorized_party: "https://app.example.com",
      tenant_id: "org_123",
      workspace_ids: ["workspace_123"],
      provider_claims: {
        organization_id: "org_123",
        provider: "clerk",
      },
    });
    expect(JSON.stringify(result.claims)).not.toContain("secret-token-value");
  });

  test("fails closed when Clerk verification claims are missing", () => {
    const result = validateAuthClaims(
      {
        provider: "clerk",
        subject: "user_123",
        access_token: "secret-token-value",
      },
      { requireClerkVerification: true },
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("AUTH_CLAIMS_INVALID");
    expect(result.error.missing).toEqual(["issuer", "audience", "authorized_party"]);
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

  test("accepts signed return intent for allowed module paths", () => {
    const result = validateAuthReturnIntent(
      {
        return_to: "/roadmap/workspaces/workspace_123",
        return_sig: "expected-signature",
        module: "roadmap",
        workspace_id: "workspace_123",
      },
      { expectedSignature: "expected-signature" },
    );

    expect(result.ok).toBe(true);
    expect(result.intent).toEqual({
      returnTo: "/roadmap/workspaces/workspace_123",
      moduleHint: "roadmap",
      workspaceHint: "workspace_123",
    });
  });

  test("preserves signed return intent query strings after validating the path", () => {
    const result = validateAuthReturnIntent(
      {
        return_to: "/roadmap/workspaces/workspace_123?view=timeline&panel=resources",
        return_sig: "expected-signature",
      },
      { expectedSignature: "expected-signature" },
    );

    expect(result.ok).toBe(true);
    expect(result.intent.returnTo).toBe(
      "/roadmap/workspaces/workspace_123?view=timeline&panel=resources",
    );
  });

  test("rejects external or disallowed auth return paths", () => {
    const external = validateAuthReturnIntent(
      {
        return_to: "https://evil.example.com/roadmap",
        return_sig: "expected-signature",
      },
      { expectedSignature: "expected-signature" },
    );
    const disallowed = validateAuthReturnIntent(
      {
        return_to: "/admin",
        return_sig: "expected-signature",
      },
      { expectedSignature: "expected-signature" },
    );

    expect(external.ok).toBe(false);
    expect(external.error.code).toBe("AUTH_RETURN_INTENT_INVALID");
    expect(external.error.reason).toBe("EXTERNAL_RETURN_URL");
    expect(disallowed.ok).toBe(false);
    expect(disallowed.error.reason).toBe("RETURN_PREFIX_NOT_ALLOWED");
  });

  test("rejects bad signatures and callback loops", () => {
    const badSignature = validateAuthReturnIntent(
      {
        return_to: "/meetings",
        return_sig: "wrong-signature",
      },
      { expectedSignature: "expected-signature" },
    );
    const loop = validateAuthReturnIntent(
      {
        return_to: authRedirectContract.callbackPath,
        return_sig: "expected-signature",
      },
      { expectedSignature: "expected-signature" },
    );

    expect(badSignature.ok).toBe(false);
    expect(badSignature.error.reason).toBe("SIGNATURE_MISMATCH");
    expect(loop.ok).toBe(false);
    expect(loop.error.reason).toBe("RETURN_LOOP");
  });

  test("requires signed return intents to be verified with an expected signature", () => {
    const missingExpectedSignature = validateAuthReturnIntent({
      return_to: "/meetings",
      return_sig: "attacker-controlled-signature",
    });
    const missingReturnSignature = validateAuthReturnIntent(
      {
        return_to: "/meetings",
      },
      { expectedSignature: "expected-signature" },
    );

    expect(missingExpectedSignature.ok).toBe(false);
    expect(missingExpectedSignature.error.reason).toBe("SIGNATURE_MISMATCH");
    expect(missingReturnSignature.ok).toBe(false);
    expect(missingReturnSignature.error.reason).toBe("SIGNATURE_MISMATCH");
  });

  test("extracts Clerk session tokens from bearer headers or session cookies", () => {
    const bearer = extractClerkSessionToken({
      headers: {
        authorization: "Bearer bearer-token-value",
      },
      cookies: {
        __session: "cookie-token-value",
      },
    });
    const cookie = extractClerkSessionToken({
      headers: {},
      cookies: {
        __session: "cookie-token-value",
      },
    });

    expect(bearer).toEqual({
      ok: true,
      token: "bearer-token-value",
      source: clerkJwtVerificationContract.tokenSources.authorizationHeader,
    });
    expect(cookie).toEqual({
      ok: true,
      token: "cookie-token-value",
      source: clerkJwtVerificationContract.tokenSources.sessionCookie,
    });
  });

  test("extracts Clerk session tokens from Next-style cookie stores", () => {
    const cookie = extractClerkSessionToken({
      headers: new Headers(),
      cookies: {
        get(name) {
          return name === "__session" ? { value: "cookie-store-token-value" } : undefined;
        },
      },
    });

    expect(cookie).toEqual({
      ok: true,
      token: "cookie-store-token-value",
      source: clerkJwtVerificationContract.tokenSources.sessionCookie,
    });
  });

  test("validates Clerk JWT payload metadata after signature verification", () => {
    const result = validateClerkJwtPayload(
      {
        iss: "https://clerk.example.com",
        aud: "product-suite",
        sub: "user_123",
        azp: "https://app.example.com",
        exp: 200,
        nbf: 50,
        iat: 100,
        jti: "jwt_123",
      },
      {
        issuer: "https://clerk.example.com",
        audience: "product-suite",
        authorizedParties: ["https://app.example.com"],
        now: 100,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.claims).toMatchObject({
      provider: "clerk",
      subject: "user_123",
      issuer: "https://clerk.example.com",
      audience: ["product-suite"],
      authorized_party: "https://app.example.com",
      issued_at: 100,
      expires_at: 200,
      jwt_id: "jwt_123",
    });
  });

  test("rejects mismatched Clerk JWT issuer audience or authorized party without token leakage", () => {
    const result = validateClerkJwtPayload(
      {
        iss: "https://wrong.example.com",
        aud: "other-suite",
        sub: "user_123",
        azp: "https://evil.example.com",
        exp: 200,
        nbf: 50,
        raw_token: "secret-token-value",
      },
      {
        issuer: "https://clerk.example.com",
        audience: "product-suite",
        authorizedParties: ["https://app.example.com"],
        now: 100,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("CLERK_JWT_INVALID");
    expect(result.error.reason).toBe("ISSUER_MISMATCH");
    expect(JSON.stringify(result)).not.toContain("secret-token-value");
  });

  test("defines Clerk user organization sync without PR19 schema migrations", () => {
    expect(platformIdentitySyncContract.provider).toBe("clerk");
    expect(platformIdentitySyncContract.user.externalProviderIdKey).toBe(
      "external_provider_id",
    );
    expect(platformIdentitySyncContract.workspace.externalProviderIdKey).toBe(
      "external_provider_id",
    );
    expect(platformIdentitySyncContract.membership.externalUserIdKey).toBe(
      "clerk_user_id",
    );
    expect(platformIdentitySyncContract.sync.idempotencyKey).toBe("clerk_event_id");
    expect(platformIdentitySyncContract.sync.reconciliationMode).toBe("lazy_first_request");
    expect(platformIdentitySyncContract.scope.createsSchemaMigrations).toBe(false);
  });

  test("defines platform event identity fields before analytics sinks exist", () => {
    expect(platformEventIdentityContract.identity.userIdKey).toBe("platform_user_id");
    expect(platformEventIdentityContract.identity.workspaceIdKey).toBe(
      "platform_workspace_id",
    );
    expect(platformEventIdentityContract.context.moduleKey).toBe("module");
    expect(platformEventIdentityContract.context.acquisitionSourceKey).toBe(
      "acquisition_source",
    );
    expect(platformEventIdentityContract.context.pricingVariantKey).toBe(
      "pricing_variant",
    );
    expect(platformEventIdentityContract.scope.implementsAnalyticsSink).toBe(false);
  });
});
