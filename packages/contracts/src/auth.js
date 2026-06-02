export const authCoreContract = {
  module: "auth",
  claims: {
    shape: "AuthClaims",
    requiredKeys: ["provider", "subject"],
    optionalKeys: [
      "issuer",
      "audience",
      "authorized_party",
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
  supabaseRls: {
    shape: "PlatformSupabaseRlsContract",
    claimsKey: "platform_rls_claims",
  },
};

const AUTH_ALLOWED_REDIRECT_PREFIXES = Object.freeze([
  "/",
  "/meetings",
  "/roadmap",
  "/canvas",
  "/agents",
  "/settings",
]);

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
    allowedRedirectPrefixes: AUTH_ALLOWED_REDIRECT_PREFIXES,
  },
  runtimeModes: {
    local: "local",
    preview: "preview",
    production: "production",
  },
};

export const authRedirectContract = {
  returnToKey: "return_to",
  signatureKey: "return_sig",
  moduleHintKey: "module",
  workspaceHintKey: "workspace_id",
  callbackPath: "/auth/callback",
  signInPath: "/sign-in",
  signUpPath: "/sign-up",
  allowedRedirectPrefixes: AUTH_ALLOWED_REDIRECT_PREFIXES,
};

export const clerkJwtVerificationContract = {
  tokenSources: {
    authorizationHeader: "authorization_header",
    sessionCookie: "__session",
  },
  authorizationScheme: "Bearer",
  algorithms: ["RS256"],
  requiredClaims: ["iss", "aud", "sub", "exp", "nbf"],
  authorizedPartyClaim: "azp",
  jwks: {
    keyIdClaim: "kid",
    cacheKey: "clerk_jwks",
  },
};

export const platformSupabaseRlsContract = {
  provider: "clerk",
  jwtTemplate: "product_suite_supabase",
  rlsIdentitySource: "jwt_claims",
  claims: {
    internalUserId: "platform_user_id",
    internalWorkspaceId: "platform_workspace_id",
    internalMembershipId: "platform_membership_id",
    externalSubject: "sub",
    externalOrganizationId: "org_id",
    issuer: "iss",
    audience: "aud",
  },
  allowedBrowserSchemas: ["public"],
  privateSchemas: ["platform", "meeting", "roadmap", "agent", "realtime"],
  disallowedAssumptions: ["auth.uid() equals Clerk sub"],
};

export const platformIdentitySyncContract = {
  provider: "clerk",
  user: {
    internalUserIdKey: "platform_user_id",
    externalProviderKey: "external_provider",
    externalProviderIdKey: "external_provider_id",
    externalUserIdKey: "clerk_user_id",
    emailKey: "email",
    displayNameKey: "display_name",
  },
  workspace: {
    internalWorkspaceIdKey: "platform_workspace_id",
    externalProviderKey: "external_provider",
    externalProviderIdKey: "external_provider_id",
    externalOrganizationIdKey: "clerk_organization_id",
    nameKey: "name",
    disabledAtKey: "disabled_at",
  },
  membership: {
    internalMembershipIdKey: "platform_membership_id",
    internalUserIdKey: "platform_user_id",
    internalWorkspaceIdKey: "platform_workspace_id",
    externalUserIdKey: "clerk_user_id",
    externalOrganizationIdKey: "clerk_organization_id",
    roleKey: "role",
    statusKey: "status",
    lastSyncedAtKey: "last_synced_at",
  },
  sync: {
    idempotencyKey: "clerk_event_id",
    reconciliationMode: "lazy_first_request",
    softDeleteMode: "soft_disable_workspace",
  },
  scope: {
    createsSchemaMigrations: false,
  },
};

export const platformEventIdentityContract = {
  identity: {
    userIdKey: "platform_user_id",
    workspaceIdKey: "platform_workspace_id",
    membershipIdKey: "platform_membership_id",
  },
  context: {
    moduleKey: "module",
    eventNameKey: "event_name",
    acquisitionSourceKey: "acquisition_source",
    pricingVariantKey: "pricing_variant",
  },
  scope: {
    implementsAnalyticsSink: false,
  },
};

const REQUIRED_AUTH_CLAIM_KEYS = authCoreContract.claims.requiredKeys;
const REQUIRED_CLERK_VERIFICATION_KEYS = [
  ...REQUIRED_AUTH_CLAIM_KEYS,
  "issuer",
  "audience",
  "authorized_party",
];
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

export function validateAuthClaims(input, options = {}) {
  const requiredKeys =
    options.requireClerkVerification && input?.provider === "clerk"
      ? REQUIRED_CLERK_VERIFICATION_KEYS
      : REQUIRED_AUTH_CLAIM_KEYS;

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return authClaimsError(requiredKeys);
  }

  const missing = requiredKeys.filter((key) => !hasRequiredAuthClaimValue(input[key], key));
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

export function validateAuthReturnIntent(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return authReturnIntentError("MISSING_RETURN_TO");
  }

  const returnTo = input[authRedirectContract.returnToKey];
  if (!hasNonEmptyString(returnTo)) {
    return authReturnIntentError("MISSING_RETURN_TO");
  }

  if (!hasValidReturnSignature(input, options)) {
    return authReturnIntentError("SIGNATURE_MISMATCH");
  }

  if (isExternalReturnUrl(returnTo)) {
    return authReturnIntentError("EXTERNAL_RETURN_URL");
  }

  const returnTarget = normalizeReturnTarget(returnTo);
  const returnPath = getReturnPathname(returnTarget);
  if (isReturnLoop(returnPath)) {
    return authReturnIntentError("RETURN_LOOP");
  }

  if (!isAllowedReturnPath(returnPath)) {
    return authReturnIntentError("RETURN_PREFIX_NOT_ALLOWED");
  }

  return {
    ok: true,
    intent: {
      returnTo: returnTarget,
      moduleHint: normalizeOptionalString(input[authRedirectContract.moduleHintKey]),
      workspaceHint: normalizeOptionalString(input[authRedirectContract.workspaceHintKey]),
    },
  };
}

export function extractClerkSessionToken(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return clerkSessionTokenError();
  }

  const authorization = getHeaderValue(input.headers, "authorization");
  const bearerToken = extractBearerToken(authorization);
  if (bearerToken) {
    return {
      ok: true,
      token: bearerToken,
      source: clerkJwtVerificationContract.tokenSources.authorizationHeader,
    };
  }

  const cookieToken = getCookieValue(input.cookies, clerkJwtVerificationContract.tokenSources.sessionCookie);
  if (hasNonEmptyString(cookieToken)) {
    return {
      ok: true,
      token: cookieToken,
      source: clerkJwtVerificationContract.tokenSources.sessionCookie,
    };
  }

  return clerkSessionTokenError();
}

export function validateClerkJwtPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return clerkJwtError("PAYLOAD_INVALID");
  }

  for (const claim of clerkJwtVerificationContract.requiredClaims) {
    if (!hasRequiredJwtClaim(payload[claim], claim)) {
      return clerkJwtError("MISSING_CLAIM", claim);
    }
  }

  if (payload.iss !== options.issuer) {
    return clerkJwtError("ISSUER_MISMATCH");
  }

  const tokenAudiences = normalizeStringList(payload.aud);
  const expectedAudiences = normalizeStringList(options.audience);
  if (!expectedAudiences.some((audience) => tokenAudiences.includes(audience))) {
    return clerkJwtError("AUDIENCE_MISMATCH");
  }

  const now = Number.isFinite(options.now) ? options.now : Math.floor(Date.now() / 1000);
  if (Number(payload.exp) <= now) {
    return clerkJwtError("TOKEN_EXPIRED");
  }
  if (Number(payload.nbf) > now) {
    return clerkJwtError("TOKEN_NOT_YET_VALID");
  }

  const authorizedParties = normalizeStringList(options.authorizedParties);
  if (!authorizedParties.includes(payload[clerkJwtVerificationContract.authorizedPartyClaim])) {
    return clerkJwtError("AUTHORIZED_PARTY_MISMATCH");
  }

  return validateAuthClaims(
    {
      provider: "clerk",
      subject: payload.sub,
      issuer: payload.iss,
      audience: payload.aud,
      authorized_party: payload[clerkJwtVerificationContract.authorizedPartyClaim],
      issued_at: payload.iat,
      expires_at: payload.exp,
      jwt_id: payload.jti,
      provider_claims: {
        session_id: payload.sid,
        organization_id: payload.org_id,
      },
    },
    { requireClerkVerification: true },
  );
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

function hasRequiredAuthClaimValue(value, key) {
  if (ARRAY_CLAIM_KEYS.has(key)) {
    return normalizeStringList(value).length > 0;
  }

  return hasNonEmptyString(value);
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

function hasValidReturnSignature(input, options) {
  if (!hasNonEmptyString(options.expectedSignature)) {
    return false;
  }

  return input[authRedirectContract.signatureKey] === options.expectedSignature;
}

function isExternalReturnUrl(returnTo) {
  return /^[a-z][a-z0-9+.-]*:/i.test(returnTo) || returnTo.startsWith("//");
}

function normalizeReturnTarget(returnTo) {
  const target = returnTo.startsWith("/") ? returnTo : `/${returnTo}`;
  const url = new URL(target, "https://product-suite.local");

  return `${url.pathname}${url.search}` || "/";
}

function getReturnPathname(returnTarget) {
  return returnTarget.split("?")[0] || "/";
}

function isReturnLoop(path) {
  return [
    authRedirectContract.callbackPath,
    authRedirectContract.signInPath,
    authRedirectContract.signUpPath,
  ].includes(path);
}

function isAllowedReturnPath(path) {
  return authRedirectContract.allowedRedirectPrefixes.some((prefix) => {
    if (prefix === "/") {
      return path === "/";
    }

    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

function normalizeOptionalString(value) {
  return hasNonEmptyString(value) ? value : undefined;
}

function authReturnIntentError(reason) {
  return {
    ok: false,
    error: {
      code: "AUTH_RETURN_INTENT_INVALID",
      reason,
    },
  };
}

function getHeaderValue(headers, name) {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  if (typeof headers.get === "function") {
    return headers.get(name);
  }

  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function getCookieValue(cookies, name) {
  if (!cookies || typeof cookies !== "object") {
    return undefined;
  }

  if (typeof cookies.get === "function") {
    const cookie = cookies.get(name);
    return typeof cookie === "object" && cookie !== null ? cookie.value : cookie;
  }

  return cookies[name];
}

function extractBearerToken(authorization) {
  if (!hasNonEmptyString(authorization)) {
    return undefined;
  }

  const prefix = `${clerkJwtVerificationContract.authorizationScheme} `;
  return authorization.startsWith(prefix) ? authorization.slice(prefix.length).trim() : undefined;
}

function hasRequiredJwtClaim(value, claim) {
  if (claim === "aud") {
    return normalizeStringList(value).length > 0;
  }
  if (claim === "exp" || claim === "nbf") {
    return Number.isFinite(Number(value));
  }

  return hasNonEmptyString(value);
}

function clerkSessionTokenError() {
  return {
    ok: false,
    error: {
      code: "CLERK_SESSION_TOKEN_MISSING",
    },
  };
}

function clerkJwtError(reason, claim) {
  return {
    ok: false,
    error: {
      code: "CLERK_JWT_INVALID",
      reason,
      ...(claim ? { claim } : {}),
    },
  };
}
