import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { authCoreContract } from "./auth.js";

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
});
