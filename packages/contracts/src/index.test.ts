import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  canvasCoreContract,
  conversationContract,
  identityScopeContract,
  meetingCoreContract,
} from "./index.js";

describe("@product-suite/contracts", () => {
  test("exports the minimal contracts nucleus", () => {
    const identityArtifact = JSON.parse(
      readFileSync(new URL("../contracts/identity-scope.json", import.meta.url), "utf8"),
    );
    const conversationArtifact = JSON.parse(
      readFileSync(new URL("../contracts/conversation.json", import.meta.url), "utf8"),
    );
    const meetingArtifact = JSON.parse(
      readFileSync(new URL("../contracts/meeting-runtime-config.json", import.meta.url), "utf8"),
    );
    const canvasArtifact = JSON.parse(
      readFileSync(new URL("../contracts/canvas-core.json", import.meta.url), "utf8"),
    );

    expect(identityScopeContract.module).toBe("identity");
    expect(identityScopeContract.auth.providerKey).toBe("provider");
    expect(identityScopeContract.auth.supportedProvidersKey).toBe("supported_providers");
    expect(identityScopeContract).toEqual(identityArtifact);

    expect(conversationContract.module).toBe("conversation");
    expect(conversationContract.thread.table).toBe("chat_threads");
    expect(conversationContract.message.table).toBe("chat_messages");
    expect(conversationContract).toEqual(conversationArtifact);

    expect(meetingCoreContract.module).toBe("meeting");
    expect(meetingCoreContract.runtimeConfig.auth.providerKey).toBe("provider");
    expect(meetingCoreContract.runtimeConfig.backendUrlKey).toBe("backend_url");
    expect(meetingCoreContract).toEqual(meetingArtifact);

    expect(canvasCoreContract.module).toBe("canvas");
    expect(canvasCoreContract.document.table).toBe("blocksuite_documents");
    expect(canvasCoreContract.document.workspaceIdKey).toBe("workspace_id");
    expect(canvasCoreContract).toEqual(canvasArtifact);
  });

  test("exports auth contracts for PR5 adapter boundaries", async () => {
    const {
      authCoreContract,
      authRedirectContract,
      clerkJwtVerificationContract,
      clerkEnvironmentContract,
      extractClerkSessionToken,
      platformEventIdentityContract,
      platformIdentitySyncContract,
      validateAuthReturnIntent,
      validateClerkEnvironment,
      validateClerkJwtPayload,
    } = await import("./index.js");
    const authArtifact = JSON.parse(
      readFileSync(new URL("../contracts/auth-core.json", import.meta.url), "utf8"),
    );

    expect(authCoreContract.module).toBe("auth");
    expect(authCoreContract.claims.requiredKeys).toContain("provider");
    expect(authCoreContract.claims.requiredKeys).toContain("subject");
    expect(authCoreContract.tokenVerifier.outputKey).toBe("auth_claims");
    expect(authCoreContract.sessionBridge.stateKey).toBe("auth_state");
    expect(authCoreContract.workspaceAccessResolver.workspaceIdKey).toBe("workspace_id");
    expect(authCoreContract).toEqual(authArtifact);
    expect(authRedirectContract.callbackPath).toBe("/auth/callback");
    expect(validateAuthReturnIntent).toBeTypeOf("function");
    expect(clerkEnvironmentContract.provider).toBe("clerk");
    expect(validateClerkEnvironment).toBeTypeOf("function");
    expect(clerkJwtVerificationContract.algorithms).toContain("RS256");
    expect(extractClerkSessionToken).toBeTypeOf("function");
    expect(validateClerkJwtPayload).toBeTypeOf("function");
    expect(platformIdentitySyncContract.scope.createsSchemaMigrations).toBe(false);
    expect(platformEventIdentityContract.scope.implementsAnalyticsSink).toBe(false);
  });
});
