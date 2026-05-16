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
export const conversationContract: ConversationContract;
export const meetingCoreContract: MeetingCoreContract;
export const canvasCoreContract: CanvasCoreContract;
