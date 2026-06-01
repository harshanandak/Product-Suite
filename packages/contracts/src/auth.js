export const authCoreContract = {
  module: "auth",
  claims: {
    shape: "AuthClaims",
    requiredKeys: ["provider", "subject"],
    optionalKeys: [
      "issuer",
      "audience",
      "email",
      "display_name",
      "tenant_id",
      "workspace_ids",
      "roles",
      "permissions",
      "issued_at",
      "expires_at",
      "jwt_id",
      "provider_claims",
    ],
  },
  tokenVerifier: {
    shape: "TokenVerifier",
    inputKey: "authorization",
    outputKey: "auth_claims",
    failureKey: "auth_error",
  },
  sessionBridge: {
    shape: "SessionBridge",
    stateKey: "auth_state",
    claimsKey: "auth_claims",
    tokenKey: "access_token",
  },
  workspaceAccessResolver: {
    shape: "WorkspaceAccessResolver",
    workspaceIdKey: "workspace_id",
    claimsKey: "auth_claims",
    resultKey: "workspace_access",
  },
};

export const clerkEnvironmentContract = {
  provider: "clerk",
  keys: {
    publishableKey: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    secretKey: "CLERK_SECRET_KEY",
    issuer: "CLERK_ISSUER",
    audience: "CLERK_AUDIENCE",
    authorizedParties: "CLERK_AUTHORIZED_PARTIES",
    signInUrl: "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
    signUpUrl: "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
    signInFallbackRedirectUrl: "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
    signUpFallbackRedirectUrl: "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
  },
  routes: {
    publicRoutes: ["/sign-in(.*)", "/sign-up(.*)"],
    protectedPrefixes: ["/meetings", "/roadmap", "/canvas", "/agents", "/settings"],
    callbackPath: "/auth/callback",
    allowedRedirectPrefixes: ["/", "/meetings", "/roadmap", "/canvas", "/agents", "/settings"],
  },
  runtimeModes: {
    local: "local",
    preview: "preview",
    production: "production",
  },
};

const REQUIRED_AUTH_CLAIM_KEYS = authCoreContract.claims.requiredKeys;
const AUTH_CLAIM_KEYS = new Set([
  ...authCoreContract.claims.requiredKeys,
  ...authCoreContract.claims.optionalKeys,
]);
const ARRAY_CLAIM_KEYS = new Set(["audience", "workspace_ids", "roles", "permissions"]);

const PROTECTED_CLERK_ENV_KEYS = [
  clerkEnvironmentContract.keys.publishableKey,
  clerkEnvironmentContract.keys.secretKey,
  clerkEnvironmentContract.keys.issuer,
  clerkEnvironmentContract.keys.audience,
  clerkEnvironmentContract.keys.authorizedParties,
];

const PUBLIC_CLERK_ENV_KEYS = [clerkEnvironmentContract.keys.publishableKey];

export function validateAuthClaims(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return authClaimsError(REQUIRED_AUTH_CLAIM_KEYS);
  }

  const missing = REQUIRED_AUTH_CLAIM_KEYS.filter((key) => !hasNonEmptyString(input[key]));
  if (missing.length > 0) {
    return authClaimsError(missing);
  }

  return {
    ok: true,
    claims: normalizeAuthClaims(input),
  };
}

export function validateClerkEnvironment(input, options = {}) {
  const protectedRuntime = options.protectedRuntime !== false;
  const requiredKeys = protectedRuntime ? PROTECTED_CLERK_ENV_KEYS : PUBLIC_CLERK_ENV_KEYS;

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return clerkEnvironmentError(requiredKeys);
  }

  const missing = requiredKeys.filter((key) => !hasRequiredClerkEnvValue(input[key], key));
  if (missing.length > 0) {
    return clerkEnvironmentError(missing);
  }

  return {
    ok: true,
    environment: normalizeClerkEnvironment(input),
  };
}

function normalizeAuthClaims(input) {
  const claims = {};

  for (const key of AUTH_CLAIM_KEYS) {
    if (input[key] === undefined || input[key] === null) {
      continue;
    }

    if (ARRAY_CLAIM_KEYS.has(key)) {
      const values = Array.isArray(input[key]) ? input[key] : [input[key]];
      claims[key] = values.filter((value) => typeof value === "string" && value.length > 0);
      continue;
    }

    if (key === "provider_claims" && typeof input[key] === "object" && !Array.isArray(input[key])) {
      claims[key] = { ...input[key] };
      continue;
    }

    claims[key] = input[key];
  }

  return claims;
}

function hasNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function authClaimsError(missing) {
  return {
    ok: false,
    error: {
      code: "AUTH_CLAIMS_INVALID",
      missing,
    },
  };
}

function normalizeClerkEnvironment(input) {
  const keys = clerkEnvironmentContract.keys;

  return {
    provider: clerkEnvironmentContract.provider,
    publishableKey: input[keys.publishableKey],
    secretKeyConfigured: hasNonEmptyString(input[keys.secretKey]),
    issuer: input[keys.issuer],
    audience: normalizeStringList(input[keys.audience]),
    authorizedParties: normalizeStringList(input[keys.authorizedParties]),
    signInUrl: input[keys.signInUrl],
    signUpUrl: input[keys.signUpUrl],
    signInFallbackRedirectUrl: input[keys.signInFallbackRedirectUrl],
    signUpFallbackRedirectUrl: input[keys.signUpFallbackRedirectUrl],
    publicRoutes: [...clerkEnvironmentContract.routes.publicRoutes],
    protectedPrefixes: [...clerkEnvironmentContract.routes.protectedPrefixes],
    callbackPath: clerkEnvironmentContract.routes.callbackPath,
    allowedRedirectPrefixes: [...clerkEnvironmentContract.routes.allowedRedirectPrefixes],
  };
}

function hasRequiredClerkEnvValue(value, key) {
  if (key === clerkEnvironmentContract.keys.audience || key === clerkEnvironmentContract.keys.authorizedParties) {
    return normalizeStringList(value).length > 0;
  }

  return hasNonEmptyString(value);
}

function normalizeStringList(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");

  return values.map((item) => String(item).trim()).filter(Boolean);
}

function clerkEnvironmentError(missing) {
  return {
    ok: false,
    error: {
      code: "CLERK_ENV_INVALID",
      missing,
    },
  };
}
