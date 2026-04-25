export interface IdentityScopeContract {
  module: "identity";
  auth: {
    providerKey: string;
    requiredKey: string;
    modeKey: string;
    supportedProvidersKey: string;
    organizationRequiredKey: string;
    onboardingRequiredKey: string;
  };
  deployment: {
    deploymentModeKey: string;
    tenantModeKey: string;
  };
}

export interface ConversationContract {
  module: "conversation";
  thread: {
    table: string;
  };
  message: {
    table: string;
  };
}

export interface MeetingCoreContract {
  module: "meeting";
  runtimeConfig: {
    backendUrlKey: string;
    auth: {
      providerKey: string;
      neonAuthUrlKey: string;
    };
  };
}

export interface CanvasCoreContract {
  module: "canvas";
  document: {
    table: string;
    workspaceIdKey: string;
  };
}

export const identityScopeContract: IdentityScopeContract;
export const conversationContract: ConversationContract;
export const meetingCoreContract: MeetingCoreContract;
export const canvasCoreContract: CanvasCoreContract;
