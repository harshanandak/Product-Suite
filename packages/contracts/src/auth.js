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

const REQUIRED_AUTH_CLAIM_KEYS = authCoreContract.claims.requiredKeys;
const AUTH_CLAIM_KEYS = new Set([
  ...authCoreContract.claims.requiredKeys,
  ...authCoreContract.claims.optionalKeys,
]);
const ARRAY_CLAIM_KEYS = new Set(["audience", "workspace_ids", "roles", "permissions"]);

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
