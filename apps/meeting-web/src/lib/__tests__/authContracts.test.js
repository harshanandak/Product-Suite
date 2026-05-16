import { describe, expect, it } from "vitest";

import { mapHostedSessionToAuthClaims } from "../authContracts.js";

describe("meeting-web auth contract adapters", () => {
  it("maps a hosted auth session to shared auth claims without leaking tokens", () => {
    const result = mapHostedSessionToAuthClaims({
      session: {
        token: "secret-session-token",
        user: {
          id: "user_123",
          email: "user@example.com",
          name: "User Example",
        },
        organization: {
          id: "tenant_123",
        },
      },
      workspaceId: "workspace_123",
    });

    expect(result.ok).toBe(true);
    expect(result.claims).toMatchObject({
      provider: "hosted",
      subject: "user_123",
      email: "user@example.com",
      display_name: "User Example",
      tenant_id: "tenant_123",
      workspace_ids: ["workspace_123"],
    });
    expect(JSON.stringify(result)).not.toContain("secret-session-token");
  });
});
