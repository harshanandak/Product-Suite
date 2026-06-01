export interface IdentityScopeContract {
  module: "identity";
  auth: {
    providerKey: string;
    requiredKey: string;
    modeKey: string;
    supportedProvidersKey: string;
    organizationRequiredKey: string;
    onboardingRequiredKey: string;
    hostedAuthUrlKey: string;
  };
  deployment: {
    deploymentModeKey: string;
    tenantModeKey: string;
    backendUrlKey: string;
  };
}

export interface AuthCoreContract {
  module: "auth";
  claims: {
    shape: "AuthClaims";
    requiredKeys: string[];
    optionalKeys: string[];
  };
  tokenVerifier: {
    shape: "TokenVerifier";
    inputKey: string;
    outputKey: string;
    failureKey: string;
  };
  sessionBridge: {
    shape: "SessionBridge";
    stateKey: string;
    claimsKey: string;
    tokenKey: string;
  };
  workspaceAccessResolver: {
    shape: "WorkspaceAccessResolver";
    workspaceIdKey: string;
    claimsKey: string;
    resultKey: string;
  };
}

export interface ClerkEnvironmentContract {
  provider: "clerk";
  keys: {
    publishableKey: string;
    secretKey: string;
    issuer: string;
    audience: string;
    authorizedParties: string;
    signInUrl: string;
    signUpUrl: string;
    signInFallbackRedirectUrl: string;
    signUpFallbackRedirectUrl: string;
  };
  routes: {
    publicRoutes: string[];
    protectedPrefixes: string[];
    callbackPath: string;
    allowedRedirectPrefixes: string[];
  };
  runtimeModes: {
    local: string;
    preview: string;
    production: string;
  };
}

export interface AuthRedirectContract {
  returnToKey: string;
  signatureKey: string;
  moduleHintKey: string;
  workspaceHintKey: string;
  callbackPath: string;
  signInPath: string;
  signUpPath: string;
  allowedRedirectPrefixes: string[];
}

export interface AuthClaims {
  provider: string;
  subject: string;
  issuer?: string;
  audience?: string[];
  authorized_party?: string;
  email?: string;
  display_name?: string;
  tenant_id?: string;
  workspace_ids?: string[];
  roles?: string[];
  permissions?: string[];
  issued_at?: number | string;
  expires_at?: number | string;
  jwt_id?: string;
  provider_claims?: Record<string, unknown>;
}

export type AuthClaimsValidationResult =
  | {
      ok: true;
      claims: AuthClaims;
    }
  | {
      ok: false;
      error: {
        code: "AUTH_CLAIMS_INVALID";
        missing: string[];
      };
    };

export interface ClerkEnvironment {
  provider: "clerk";
  publishableKey: string;
  secretKeyConfigured: boolean;
  issuer?: string;
  audience: string[];
  authorizedParties: string[];
  signInUrl?: string;
  signUpUrl?: string;
  signInFallbackRedirectUrl?: string;
  signUpFallbackRedirectUrl?: string;
  publicRoutes: string[];
  protectedPrefixes: string[];
  callbackPath: string;
  allowedRedirectPrefixes: string[];
}

export type ClerkEnvironmentValidationResult =
  | {
      ok: true;
      environment: ClerkEnvironment;
    }
  | {
      ok: false;
      error: {
        code: "CLERK_ENV_INVALID";
        missing: string[];
      };
    };

export interface AuthReturnIntent {
  returnTo: string;
  moduleHint?: string;
  workspaceHint?: string;
}

export type AuthReturnIntentValidationResult =
  | {
      ok: true;
      intent: AuthReturnIntent;
    }
  | {
      ok: false;
      error: {
        code: "AUTH_RETURN_INTENT_INVALID";
        reason:
          | "MISSING_RETURN_TO"
          | "SIGNATURE_MISMATCH"
          | "EXTERNAL_RETURN_URL"
          | "RETURN_LOOP"
          | "RETURN_PREFIX_NOT_ALLOWED";
      };
    };

export interface ConversationContract {
  module: "conversation";
  thread: {
    table: string;
    idKey: string;
    workspaceIdKey: string;
    teamIdKey: string;
    titleKey: string;
    statusKey: string;
    metadataKey: string;
    createdAtKey: string;
    updatedAtKey: string;
    createdByKey: string;
  };
  message: {
    table: string;
    idKey: string;
    threadIdKey: string;
    roleKey: string;
    contentKey: string;
    partsKey: string;
    metadataKey: string;
    toolInvocationsKey: string;
    modelUsedKey: string;
    createdAtKey: string;
  };
}

export interface MeetingCoreContract {
  module: "meeting";
  runtimeConfig: {
    deploymentModeKey: string;
    tenantModeKey: string;
    backendUrlKey: string;
    capabilitiesKey: string;
    enginesKey: string;
    auth: {
      requiredKey: string;
      modeKey: string;
      providerKey: string;
      supportedProvidersKey: string;
      organizationRequiredKey: string;
      onboardingRequiredKey: string;
      neonAuthUrlKey: string;
    };
    database: {
      providerKey: string;
    };
    storage: {
      backendKey: string;
      audioArchivalEnabledKey: string;
    };
    summaryPolicy: {
      rawAudioRetentionDaysKey: string;
      transcriptRetentionDaysKey: string;
      derivedRetentionDaysKey: string;
      stateWindowSecondsKey: string;
      chapterWindowSecondsKey: string;
      inactivityTimeoutSecondsKey: string;
      fullTranscriptRetainedKey: string;
    };
    retrievalPolicy: {
      historyCorpusKey: string;
      rankingProfileKey: string;
    };
  };
}

export interface CanvasCoreContract {
  module: "canvas";
  document: {
    table: string;
    idKey: string;
    workspaceIdKey: string;
    teamIdKey: string;
    documentTypeKey: string;
    storagePathKey: string;
    storageSizeBytesKey: string;
    syncVersionKey: string;
    activeEditorsKey: string;
    lastSyncAtKey: string;
    titleKey: string;
    createdAtKey: string;
    updatedAtKey: string;
  };
}

export const identityScopeContract: IdentityScopeContract;
export const authCoreContract: AuthCoreContract;
export const authRedirectContract: AuthRedirectContract;
export const clerkEnvironmentContract: ClerkEnvironmentContract;
export function validateAuthClaims(
  input: unknown,
  options?: { requireClerkVerification?: boolean },
): AuthClaimsValidationResult;
export function validateAuthReturnIntent(
  input: unknown,
  options?: { expectedSignature?: string },
): AuthReturnIntentValidationResult;
export function validateClerkEnvironment(
  input: unknown,
  options?: { protectedRuntime?: boolean },
): ClerkEnvironmentValidationResult;
export const conversationContract: ConversationContract;
export const meetingCoreContract: MeetingCoreContract;
export const canvasCoreContract: CanvasCoreContract;
