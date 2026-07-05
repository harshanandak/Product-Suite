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
  supabaseRls: {
    shape: "PlatformSupabaseRlsContract";
    claimsKey: string;
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
    allowedRedirectPrefixes: readonly string[];
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
  allowedRedirectPrefixes: readonly string[];
}

export interface ClerkJwtVerificationContract {
  tokenSources: {
    authorizationHeader: string;
    sessionCookie: string;
  };
  authorizationScheme: string;
  algorithms: string[];
  requiredClaims: string[];
  authorizedPartyClaim: string;
  jwks: {
    keyIdClaim: string;
    cacheKey: string;
  };
}

export interface PlatformSupabaseRlsContract {
  provider: "clerk";
  jwtTemplate: string;
  rlsIdentitySource: string;
  claims: {
    internalUserId: string;
    internalWorkspaceId: string;
    internalMembershipId: string;
    externalSubject: string;
    externalOrganizationId: string;
    issuer: string;
    audience: string;
  };
  allowedBrowserSchemas: readonly string[];
  privateSchemas: readonly string[];
  supabaseManagedSchemas: readonly string[];
  disallowedAssumptions: readonly string[];
}

export interface PlatformIdentitySyncContract {
  provider: "clerk";
  user: {
    internalUserIdKey: string;
    externalProviderKey: string;
    externalProviderIdKey: string;
    externalUserIdKey: string;
    emailKey: string;
    displayNameKey: string;
  };
  workspace: {
    internalWorkspaceIdKey: string;
    externalProviderKey: string;
    externalProviderIdKey: string;
    externalOrganizationIdKey: string;
    nameKey: string;
    disabledAtKey: string;
  };
  membership: {
    internalMembershipIdKey: string;
    internalUserIdKey: string;
    internalWorkspaceIdKey: string;
    externalUserIdKey: string;
    externalOrganizationIdKey: string;
    roleKey: string;
    statusKey: string;
    lastSyncedAtKey: string;
  };
  sync: {
    idempotencyKey: string;
    reconciliationMode: string;
    softDeleteMode: string;
  };
  scope: {
    createsSchemaMigrations: boolean;
  };
}

export interface PlatformEventIdentityContract {
  identity: {
    userIdKey: string;
    workspaceIdKey: string;
    membershipIdKey: string;
  };
  context: {
    moduleKey: string;
    eventNameKey: string;
    acquisitionSourceKey: string;
    pricingVariantKey: string;
  };
  scope: {
    implementsAnalyticsSink: boolean;
  };
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

export type ClerkSessionTokenExtractionResult =
  | {
      ok: true;
      token: string;
      source: string;
    }
  | {
      ok: false;
      error: {
        code: "CLERK_SESSION_TOKEN_MISSING";
      };
    };

export type ClerkJwtPayloadValidationResult =
  | AuthClaimsValidationResult
  | {
      ok: false;
      error: {
        code: "CLERK_JWT_INVALID";
        reason:
          | "PAYLOAD_INVALID"
          | "MISSING_CLAIM"
          | "ISSUER_MISMATCH"
          | "AUDIENCE_MISMATCH"
          | "TOKEN_EXPIRED"
          | "TOKEN_NOT_YET_VALID"
          | "AUTHORIZED_PARTY_MISMATCH";
        claim?: string;
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
export const clerkJwtVerificationContract: ClerkJwtVerificationContract;
export const platformIdentitySyncContract: PlatformIdentitySyncContract;
export const platformEventIdentityContract: PlatformEventIdentityContract;
export const platformSupabaseRlsContract: PlatformSupabaseRlsContract;
export function extractClerkSessionToken(input: unknown): ClerkSessionTokenExtractionResult;
export function validateAuthClaims(
  input: unknown,
  options?: { requireClerkVerification?: boolean },
): AuthClaimsValidationResult;
export function validateAuthReturnIntent(
  input: unknown,
  options: { expectedSignature: string },
): AuthReturnIntentValidationResult;
export function validateClerkEnvironment(
  input: unknown,
  options?: { protectedRuntime?: boolean },
): ClerkEnvironmentValidationResult;
export function validateClerkJwtPayload(
  payload: unknown,
  options?: {
    issuer?: string;
    audience?: string | string[];
    authorizedParties?: string[];
    now?: number;
  },
): ClerkJwtPayloadValidationResult;
export const conversationContract: ConversationContract;
export const meetingCoreContract: MeetingCoreContract;
export const canvasCoreContract: CanvasCoreContract;

// ---------------------------------------------------------------------------
// Domain enums (DESIGN §5). Framework-neutral vocabularies shared by the React
// UI, the Python backend, and the SDK. Runtime values live in `./enums.js`; the
// canonical JSON mirror is `../contracts/enums.json`. The union members below
// MUST stay in lockstep with both — `enums.test.ts` fails on drift.
// ---------------------------------------------------------------------------

/** Universal work-item phase loop (§1 / §5). */
export type Phase = "plan" | "execute" | "review" | "done";
/** Task / agent-run status triad — never on work items (§5 / §11). */
export type TaskStatus = "todo" | "in_progress" | "completed";
/** Derived work-item health — never stored (§3 / §5). */
export type Health = "on_track" | "at_risk" | "blocked";
/** Stored work-item priority / severity (§5 / §11). */
export type Priority = "critical" | "high" | "medium" | "low";
/** Kind of work a work item represents (§5 / §11). */
export type WorkItemType = "feature" | "bug" | "chore" | "research";
/** Work-item provenance — where an object came from (§5 / §11). */
export type WorkItemSource = "manual" | "meeting" | "agent" | "feedback";

export const PHASE_VALUES: readonly Phase[];
export const PHASE_LABELS: Record<Phase, string>;
export const PHASE_ORDER: readonly Phase[];
export const TASK_STATUS_VALUES: readonly TaskStatus[];
export const STATUS_LABELS: Record<TaskStatus, string>;
export const TASK_STATUS_ORDER: readonly TaskStatus[];
export const HEALTH_VALUES: readonly Health[];
export const HEALTH_LABELS: Record<Health, string>;
export const HEALTH_ORDER: readonly Health[];
export const PRIORITY_VALUES: readonly Priority[];
export const PRIORITY_LABELS: Record<Priority, string>;
export const PRIORITY_ORDER: readonly Priority[];
export const WORK_ITEM_TYPE_VALUES: readonly WorkItemType[];
export const WORK_ITEM_TYPE_LABELS: Record<WorkItemType, string>;
export const WORK_ITEM_TYPE_ORDER: readonly WorkItemType[];
export const WORK_ITEM_SOURCE_VALUES: readonly WorkItemSource[];
export const WORK_ITEM_SOURCE_LABELS: Record<WorkItemSource, string>;
export const WORK_ITEM_SOURCE_ORDER: readonly WorkItemSource[];
export const ASSIGNEE_UNASSIGNED_VALUE: "__unassigned__";

export interface EnumDescriptor<T extends string> {
  values: readonly T[];
  labels: Record<T, string>;
  order: readonly T[];
}

export const enums: {
  phase: EnumDescriptor<Phase>;
  taskStatus: EnumDescriptor<TaskStatus>;
  health: EnumDescriptor<Health>;
  priority: EnumDescriptor<Priority>;
  workItemType: EnumDescriptor<WorkItemType>;
  workItemSource: EnumDescriptor<WorkItemSource>;
  assignee: { unassignedValue: typeof ASSIGNEE_UNASSIGNED_VALUE };
};
