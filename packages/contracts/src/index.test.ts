import { describe, expect, test } from "bun:test";

import {
  canvasCoreContract,
  conversationContract,
  identityScopeContract,
  meetingCoreContract,
} from "./index.js";

describe("@product-suite/contracts", () => {
  test("exports the minimal contracts nucleus", () => {
    expect(identityScopeContract.module).toBe("identity");
    expect(identityScopeContract.auth.providerKey).toBe("provider");
    expect(identityScopeContract.auth.supportedProvidersKey).toBe("supported_providers");

    expect(conversationContract.module).toBe("conversation");
    expect(conversationContract.thread.table).toBe("chat_threads");
    expect(conversationContract.message.table).toBe("chat_messages");

    expect(meetingCoreContract.module).toBe("meeting");
    expect(meetingCoreContract.runtimeConfig.auth.providerKey).toBe("provider");
    expect(meetingCoreContract.runtimeConfig.backendUrlKey).toBe("backend_url");

    expect(canvasCoreContract.module).toBe("canvas");
    expect(canvasCoreContract.document.table).toBe("blocksuite_documents");
    expect(canvasCoreContract.document.workspaceIdKey).toBe("workspace_id");
  });
});
